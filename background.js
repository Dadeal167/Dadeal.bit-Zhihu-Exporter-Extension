// Dadealbit 知乎文章提取器 - 后台服务(Manifest V3 Service Worker)
// 职责: 静默生成 PDF(debugger/printToPDF) → 调度 offscreen 打包 zip → 下载 + 进度/完成通知
"use strict";

// ---------- 进度广播(所有上下文都能收到: 页面浮窗/弹窗/后台) ----------
function broadcastProgress(tabId, text, done) {
  chrome.runtime.sendMessage({ type: "progress", tabId, text, done: !!done })
    .catch(() => {});
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 2,
    });
  } catch (e) { /* ignore */ }
}

chrome.notifications.onClicked.addListener(() => {
  try { chrome.downloads.showDefaultFolder(); } catch (e) { /* ignore */ }
});

// ---------- offscreen 文档(负责 Blob URL 下载, SW 里不支持) ----------
async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
  } catch (e) { /* 旧版无 hasDocument, 直接尝试创建 */ }
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "生成下载用的 Blob URL(zip/pdf)",
  });
}

function cdpCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// ---------- 静默 PDF 方案1: 隐藏标签页注入完整自包含 HTML → Page.printToPDF ----------
// 用 Page.setDocumentContent 直接注入(而非 data: URL): 内容超 2MB 时 data URL 会被
// Chromium 拒绝, 注入方式无长度限制且不受扩展 CSP 约束, 内联脚本畅行无阻。
async function generatePdf(title, fullHtml) {
  if (!fullHtml) {
    throw new Error("缺少打印 HTML");
  }
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  try {
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");

    // 关键: 给页面所有请求(主要是知乎图片 CDN)附加知乎 Referer, 绕过防盗链
    await cdpCommand(tab.id, "Network.enable");
    await cdpCommand(tab.id, "Network.setExtraHTTPHeaders", {
      headers: { Referer: "https://www.zhihu.com/" },
    });

    await cdpCommand(tab.id, "Page.enable");

    // 拿到主 frame id 后注入完整 HTML
    const tree = await cdpCommand(tab.id, "Page.getFrameTree");
    const frameId = tree.frameTree && tree.frameTree.frame
      ? tree.frameTree.frame.id
      : undefined;
    await cdpCommand(tab.id, "Page.setDocumentContent", { frameId, html: fullHtml });

    // 轮询等待公式渲染 + 图片加载完成(最多 60 秒, 动图较大给足时间)。
    // 图片判定用 complete && naturalWidth>0: 能区分"还在加载"与"加载失败"
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await cdpCommand(tab.id, "Runtime.evaluate", {
          expression: "document.body.getAttribute('data-mathjax-ready')==='1' && Array.from(document.images).every(function(i){return i.complete && i.naturalWidth > 0;})",
          returnByValue: true,
        });
        if (r.result && r.result.value === true) { ready = true; break; }
      } catch (e) {
        break;
      }
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    if (!ready) {
      // 超时也继续(个别大动图可能确实拉不下来), 再等 5 秒排版
      await new Promise((r2) => setTimeout(r2, 5000));
    }

    const result = await cdpCommand(tab.id, "Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69, // A4
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    });
    return result.data; // base64
  } finally {
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch (e) { /* ignore */ }
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* ignore */ }
  }
}

// ---------- 静默 PDF 方案2(前端库): print.html?mode=js 里 html2canvas+jsPDF ----------
function generatePdfViaJs(printHtml, title) {
  return new Promise(async (resolve, reject) => {
    await chrome.storage.session.set({ printHtml, printTitle: title || "知乎文章" });
    let tab = null;
    let settled = false;

    const listener = (m) => {
      if (m.type !== "pdfJsResult") return;
      chrome.runtime.onMessage.removeListener(listener);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (m.ok && m.pdfBase64) {
        resolve(m.pdfBase64);
      } else {
        reject(new Error(m.error || "前端库生成 PDF 失败"));
      }
      if (tab && tab.id != null) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    };

    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      if (settled) return;
      settled = true;
      reject(new Error("前端库生成 PDF 超时(90秒)"));
      if (tab && tab.id != null) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    }, 90000);

    chrome.runtime.onMessage.addListener(listener);
    tab = await chrome.tabs.create({
      url: chrome.runtime.getURL("print.html?mode=js"),
      active: false,
    });
  });
}

// ---------- 图片预下载内嵌: blob → data URI, 彻底绕开防盗链 ----------
function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return "data:" + (blob.type || "image/jpeg") + ";base64," + btoa(bin);
  });
}

async function embedImagesAsDataUrls(fullHtml, images) {
  let html = fullHtml;
  await Promise.all((images || []).map(async (im) => {
    if (!im || !im.url || !html.includes(im.url) && !html.includes(im.url.replace(/&/g, "&amp;"))) {
      return; // 页面里没引用这张图, 跳过
    }
    let blob = null;
    try {
      const resp = await fetch(im.url, {
        credentials: "include",
        headers: { Referer: "https://www.zhihu.com/" },
      });
      if (resp.ok) blob = await resp.blob();
    } catch (e) { /* 继续 */ }
    if (!blob) {
      try {
        const resp = await fetch(im.url, { credentials: "include" });
        if (resp.ok) blob = await resp.blob();
      } catch (e) { /* 保留原 URL, 靠 CDP Referer 兜底 */ }
    }
    if (!blob || blob.size <= 0) return;
    try {
      const dataUrl = await blobToDataUrl(blob);
      // URL 在 HTML 里可能被序列化为 &amp;, 两种形式都替换
      html = html.split(im.url.replace(/&/g, "&amp;")).join(dataUrl)
                 .split(im.url).join(dataUrl);
    } catch (e) { /* 保留原 URL */ }
  }));
  return html;
}

// ---------- 消息路由 ----------
async function handleMessage(msg, sender) {
  if (msg.type === "whoami") {
    return { tabId: sender.tab ? sender.tab.id : null };
  }

  if (msg.type === "getMathjax") {
    // 内容脚本直接 fetch 扩展资源被拦截时, 由后台读取 MathJax 源码返回
    try {
      const resp = await fetch(chrome.runtime.getURL("lib/tex-svg-full.js"));
      if (resp.ok) {
        return { ok: true, text: await resp.text() };
      }
    } catch (e) { /* fallthrough */ }
    return { ok: false, error: "读取 lib/tex-svg-full.js 失败" };
  }

  if (msg.type === "exportZip") {
    const tabId = sender.tab ? sender.tab.id : null;
    broadcastProgress(tabId, "🔍 正在提取正文...");

    // 1. PDF(可选): debugger 静默生成 → 前端库兜底 → 打印页最后兜底
    let pdfBase64 = null;
    let pdfError = null;
    if (msg.pdf) {
      broadcastProgress(tabId, "🖨️ 正在生成 PDF...");
      try {
        // 方案①: 完整自包含 HTML(内嵌 MathJax) → debugger printToPDF
        // 先预下载图片并内嵌为 data URI, 彻底绕开知乎防盗链;
        // 个别下载失败的保留原 URL, 由 CDP 设置的 Referer 兜底
        let printFullHtml = msg.printFullHtml;
        if (printFullHtml && msg.images && msg.images.length) {
          broadcastProgress(tabId, "🖼️ 正在内嵌图片(" + msg.images.length + " 张)...");
          printFullHtml = await embedImagesAsDataUrls(printFullHtml, msg.images);
        }
        pdfBase64 = await generatePdf(msg.title, printFullHtml);
        broadcastProgress(tabId, "✅ PDF 已生成");
      } catch (e1) {
        console.warn("[Dadealbit] debugger 生成 PDF 失败, 改用前端库:", e1);
        broadcastProgress(tabId, "🧮 正在用前端库生成 PDF...");
        try {
          pdfBase64 = await generatePdfViaJs(msg.printHtml, msg.title);
          broadcastProgress(tabId, "✅ PDF 已生成(前端库)");
        } catch (e2) {
          pdfError = String(e2);
          console.warn("[Dadealbit] 前端库生成 PDF 失败:", e2);
          broadcastProgress(tabId, "⚠️ PDF 自动生成失败, 将打开打印页(请在打印对话框另存为 PDF)");
          try {
            await chrome.storage.session.set({ printHtml: msg.printHtml, printTitle: msg.title });
            await chrome.tabs.create({ url: chrome.runtime.getURL("print.html?manual=1"), active: true });
          } catch (e3) { /* ignore */ }
        }
      }
    }

    const wantArchive = !!(msg.md || msg.html);
    let result;
    if (wantArchive) {
      await ensureOffscreen();
      result = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "buildZip",
        tabId,
        title: msg.title,
        md: msg.md || null,
        html: msg.html || null,
        images: msg.images || [],
        pdfBase64,
      });
    } else if (pdfBase64) {
      await ensureOffscreen();
      result = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "savePdf",
        tabId,
        title: msg.title,
        pdfBase64,
      });
    } else {
      result = { ok: false, error: "PDF 生成失败, 请勾选 Markdown/HTML 后重试" };
    }

    // 2. 完成通知(系统级 + 页面进度条收尾)
    if (result && result.ok) {
      const extra = [];
      if (result.imagesTotal > 0) extra.push("图片 " + result.imagesOk + "/" + result.imagesTotal);
      if (msg.pdf) extra.push(pdfBase64 ? "PDF ✓" : "PDF ✗");
      const detail = extra.length ? " (" + extra.join(", ") + ")" : "";
      broadcastProgress(tabId, "✅ 已保存: " + result.filename + detail, true);
      notify("知乎提取完成", "已保存: " + result.filename + detail + "\n点击此通知打开下载文件夹");
    } else {
      broadcastProgress(tabId, "❌ 提取失败: " + (result && result.error), true);
      notify("知乎提取失败", (result && result.error) || "未知错误");
    }

    return {
      ok: result && result.ok,
      error: result && result.error,
      filename: result && result.filename,
      imagesOk: result && result.imagesOk,
      imagesTotal: result && result.imagesTotal,
      pdfOk: !!pdfBase64,
      pdfError,
    };
  }

  if (msg.type === "openPopup") {
    try {
      await chrome.action.openPopup();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (msg.type === "batchOpen") {
    await openBatch(msg.urls);
    return { ok: true };
  }

  if (msg.type === "batchDone") {
    if (sender.tab && sender.tab.id != null) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    return { ok: true };
  }
  return { ok: false, error: "未知消息类型: " + msg.type };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // 异步响应
});

// ---------- 批量: 逐个开标签页, 内容脚本提取完自报 batchDone 并关闭 ----------
async function openBatch(urls) {
  const list = (urls || [])
    .map((u) => String(u).trim())
    .filter((u) => u.startsWith("http"));
  if (!list.length) return;
  await chrome.storage.session.set({ batchActive: true, batchCount: list.length });
  for (const url of list) {
    chrome.tabs.create({ url, active: false });
    // 间隔 1.5 秒开一个, 避免瞬间大量标签页触发知乎风控
    await new Promise((r) => setTimeout(r, 1500));
  }
}
