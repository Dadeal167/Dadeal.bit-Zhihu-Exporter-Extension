// Dadealbit 知乎提取器 - Offscreen 文档
// MV3 Service Worker 里没有 URL.createObjectURL, 无法直接下载 Blob。
// 此隐藏页面负责: 抓图片字节 → JSZip 打包 → 生成 Blob URL → chrome.downloads 下载
"use strict";

function sanitizeFilename(name) {
  const cleaned = String(name || "")
    .replace(/[\\/*?:"<>|]/g, "")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || "未命名文章";
}

// 抓图片字节: 带知乎 Referer(绕过防盗链); 失败降级无 Referer; 再失败返回 null
async function fetchImageBytes(url) {
  try {
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Referer: "https://www.zhihu.com/" },
    });
    if (resp.ok) return await resp.blob();
  } catch (e) { /* 继续 */ }
  try {
    const resp = await fetch(url, { credentials: "include" });
    if (resp.ok) return await resp.blob();
  } catch (e) { /* ignore */ }
  return null;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    const aTagFallback = () => {
      // 兜底: <a download> 标签下载
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        resolve("a-tag");
      } catch (e2) {
        reject(e2);
      }
    };
    try {
      chrome.downloads.download(
        { url, filename, saveAs: false, conflictAction: "uniquify" },
        (id) => {
          if (chrome.runtime.lastError) {
            aTagFallback();
          } else {
            resolve(id);
          }
        }
      );
    } catch (e) {
      aTagFallback();
    }
  });
}

function progress(tabId, text, done) {
  chrome.runtime.sendMessage({ type: "progress", tabId, text, done: !!done })
    .catch(() => {});
}

async function buildZip(msg) {
  const safe = sanitizeFilename(msg.title);
  const zip = new JSZip();

  // 平铺结构: md/html/pdf 与 assets/、_mathjax/ 同级, 相对路径统一 assets/...
  if (msg.md) {
    zip.file(safe + ".md", msg.md);
  }
  if (msg.html) {
    zip.file(safe + ".html", msg.html);
    // MathJax 完整版打进包(内嵌失败时的本地兜底), 与 HTML 同级引用
    try {
      const resp = await fetch(chrome.runtime.getURL("lib/tex-svg-full.js"));
      if (resp.ok) {
        zip.file("_mathjax/tex-svg-full.js", await resp.blob());
      }
    } catch (e) { /* HTML 里有 CDN 兜底 */ }
  }

  const images = msg.images || [];
  let imagesOk = 0;
  for (let i = 0; i < images.length; i++) {
    progress(msg.tabId, "🖼️ 正在下载图片 (" + (i + 1) + "/" + images.length + ")...");
    const blob = await fetchImageBytes(images[i].url);
    if (blob && blob.size > 0) {
      zip.file("assets/" + safe + "/" + images[i].name, blob);
      imagesOk += 1;
    }
  }

  if (msg.pdfBase64) {
    zip.file(safe + ".pdf", base64ToBytes(msg.pdfBase64), { binary: true });
  }

  progress(msg.tabId, "📦 正在打包 zip...");
  const blob = await zip.generateAsync({ type: "blob" });
  progress(msg.tabId, "⬇️ 正在保存到下载文件夹...");
  const url = URL.createObjectURL(blob);
  const filename = "知乎导出/" + safe + ".zip";
  const downloadId = await download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return { ok: true, filename, downloadId, imagesOk, imagesTotal: images.length };
}

async function savePdf(msg) {
  const safe = sanitizeFilename(msg.title);
  const blob = new Blob([base64ToBytes(msg.pdfBase64)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const filename = "知乎导出/PDF/" + safe + ".pdf";
  progress(msg.tabId, "⬇️ 正在保存 PDF 到下载文件夹...");
  const downloadId = await download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return { ok: true, filename, downloadId };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;
  const handle = msg.type === "buildZip" ? buildZip(msg)
    : msg.type === "savePdf" ? savePdf(msg)
    : Promise.resolve({ ok: false, error: "未知任务" });
  handle
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
