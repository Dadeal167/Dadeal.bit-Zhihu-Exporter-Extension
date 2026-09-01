// Dadealbit 知乎提取器 - 打印页(三种模式)
// 默认(静默/debugger): 渲染完成即等待后台 Page.printToPDF 抓取
// ?mode=js(前端库兜底): 渲染完成后用 html2canvas + jsPDF 生成 PDF, 把 base64 送回后台
// ?manual=1(最后兜底): 渲染完成后唤起打印对话框, 用户手动另存为 PDF
"use strict";

// 用绝对扩展路径注入 MathJax(避免任何相对路径歧义)
(function injectMathJax() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("lib/tex-svg-full.js");
  s.async = true;
  document.head.appendChild(s);
})();

(async () => {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "";
  const isManual = params.get("manual") === "1";

  const data = await chrome.storage.session.get(["printHtml", "printTitle"]);
  if (data.printTitle) {
    document.title = data.printTitle;
  }
  const content = document.getElementById("content");
  content.innerHTML = data.printHtml || "<p>没有待打印的内容</p>";

  // 1. 等图片加载完成(知乎 CDN 原图), 20 秒兜底
  const pending = Array.from(document.images).filter((img) => !img.complete);
  if (pending.length) {
    await Promise.race([
      Promise.all(pending.map((img) => new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      }))),
      new Promise((resolve) => setTimeout(resolve, 20000)),
    ]);
  }

  // 2. 等 MathJax 渲染公式完成(data-mathjax-ready 标记), 20 秒兜底
  if (document.body.getAttribute("data-mathjax-ready") !== "1") {
    await Promise.race([
      new Promise((resolve) => {
        const timer = setInterval(() => {
          if (document.body.getAttribute("data-mathjax-ready") === "1") {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      }),
      new Promise((resolve) => setTimeout(resolve, 20000)),
    ]);
  }

  // 3. 再留一点排版时间
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (mode === "js") {
    generatePdfWithJs().catch((e) => {
      chrome.runtime.sendMessage({ type: "pdfJsResult", ok: false, error: String(e) });
    });
  } else if (isManual) {
    // 最后兜底: 静默/前端库都失败时用户手动保存
    window.print();
  }
  // 默认模式: 什么都不做, 等待后台 debugger 抓取
})();

// 前端库生成 PDF: html2canvas 截图 + jsPDF 分页(不弹任何界面)
async function generatePdfWithJs() {
  // 先把图片换成同源 URL(扩展页有 zhimg 主机权限, fetch 不受 CORS 限制),
  // 并带知乎 Referer 绕过防盗链; 否则 html2canvas 会因跨域图片失败
  await Promise.all(Array.from(document.images).map(async (img) => {
    if (!img.src || !/^https?:/i.test(img.src)) return;
    let blob = null;
    try {
      const resp = await fetch(img.src, {
        credentials: "include",
        headers: { Referer: "https://www.zhihu.com/" },
      });
      if (resp.ok) blob = await resp.blob();
    } catch (e) { /* 继续 */ }
    if (!blob) {
      try {
        const resp = await fetch(img.src, { credentials: "include" });
        if (resp.ok) blob = await resp.blob();
      } catch (e2) { /* 失败保持原样, 后面按失败图处理 */ }
    }
    if (blob) {
      img.src = URL.createObjectURL(blob);
    }
  }));

  const target = document.getElementById("content");
  const canvas = await html2canvas(target, {
    scale: 2,
    useCORS: false,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: 900,
  });

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const imgW = pageW - margin * 2;
  const imgH = canvas.height * imgW / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  // 固定高度切片分页
  let heightLeft = imgH;
  let position = margin;
  pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
  heightLeft -= pageH - margin * 2;
  while (heightLeft > 0) {
    position -= pageH - margin * 2;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
    heightLeft -= pageH - margin * 2;
  }

  const dataUrl = pdf.output("datauristring"); // data:application/pdf;base64,...
  const pdfBase64 = dataUrl.split(",")[1] || "";
  if (!pdfBase64) {
    throw new Error("PDF 编码失败");
  }
  chrome.runtime.sendMessage({ type: "pdfJsResult", ok: true, pdfBase64 });
}
