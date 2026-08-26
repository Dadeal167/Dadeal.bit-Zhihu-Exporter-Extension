// Dadealbit 知乎提取器 - 弹窗逻辑
"use strict";

const $ = (id) => document.getElementById(id);

function status(msg, isErr) {
  const el = $("status");
  el.textContent = msg;
  el.className = isErr ? "err" : "";
}

function getFormats() {
  return { md: $("cbMd").checked, html: $("cbHtml").checked, pdf: $("cbPdf").checked };
}

async function saveSettings() {
  await chrome.storage.local.set({ formats: getFormats() });
}

async function loadSettings() {
  const data = await chrome.storage.local.get(["formats"]);
  const f = data.formats || { md: true, html: true, pdf: false };
  $("cbMd").checked = f.md !== false;
  $("cbHtml").checked = f.html !== false;
  $("cbPdf").checked = f.pdf === true;
}

["cbMd", "cbHtml", "cbPdf"].forEach((id) => {
  $(id).addEventListener("change", saveSettings);
});

function resultText(res) {
  if (!res.ok) {
    return (res.error || "提取失败") + (res.pdfError ? "(PDF: " + res.pdfError + ")" : "");
  }
  let text = "已打包下载: " + res.filename;
  if (res.imagesTotal > 0) {
    text += " (图片 " + res.imagesOk + "/" + res.imagesTotal + ")";
  }
  if (res.pdf) {
    text += res.pdfOk ? " (含 PDF✓)" : " (PDF✗, 已打开打印页兜底)";
  }
  return text;
}

$("btnExtract").addEventListener("click", async () => {
  const formats = getFormats();
  if (!formats.md && !formats.html && !formats.pdf) {
    status("请至少勾选一种导出格式", true);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/https?:\/\/([a-z]+\.)?zhihu\.com\//.test(tab.url || "")) {
    status("请先打开一个知乎文章/回答页面", true);
    return;
  }
  status("正在提取并打包...");
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "extract", formats });
    status(resultText(res || { ok: false, error: "无响应" }), !(res && res.ok));
  } catch (e) {
    status("无法连接页面: 请刷新知乎页面后重试", true);
  }
});

$("btnBatch").addEventListener("click", async () => {
  const urls = $("batchUrls").value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /https?:\/\/([a-z]+\.)?zhihu\.com\//.test(s));
  if (!urls.length) {
    status("请粘贴至少一个知乎链接(每行一个)", true);
    return;
  }
  const formats = getFormats();
  if (!formats.md && !formats.html && !formats.pdf) {
    status("请至少勾选一种导出格式", true);
    return;
  }
  await saveSettings();
  await chrome.runtime.sendMessage({ type: "batchOpen", urls });
  status("已开始批量提取 " + urls.length + " 个链接(每个自动打包为 zip, 提取完标签页自动关闭)");
});

// 进度广播: 弹窗开着时实时显示当前步骤
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress" && msg.text) {
    status(msg.text);
  }
});

loadSettings();
