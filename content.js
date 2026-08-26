// Dadealbit 知乎文章提取器 - 内容脚本
// 直接从已登录的知乎页面 DOM 提取文章/回答, 打包任务交给后台(图片+MathJax 一起打 zip)
(function () {
  "use strict";
  if (window.__dadealbitInjected) return;
  window.__dadealbitInjected = true;

  const CONTENT_SELECTORS = [
    ".Post-RichText",               // 专栏文章
    ".RichContent-inner",           // 回答
    ".AnswerItem .RichText",
    ".RichText.ztext.Post-RichText",
    ".RichText",
    ".Post-Content",
  ];

  function pick() {
    for (const sel of CONTENT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isTargetPage() {
    return /zhihu\.com\/(p\/\d+|answer\/\d+)/.test(location.href);
  }

  function sanitize(name) {
    const cleaned = String(name || "")
      .replace(/[\\/*?:"<>|]/g, "").trim().replace(/[. ]+$/g, "");
    return cleaned || "未命名文章";
  }

  function getAuthor() {
    const el = document.querySelector(
      ".AuthorInfo-name .UserLink, .AuthorInfo .UserLink, .Post-Author .UserLink");
    return el ? el.textContent.trim() : "";
  }

  function getDate() {
    const el = document.querySelector(
      "time, .ContentItem-time, [itemprop='dateModified'], [itemprop='datePublished'], .Post-Meta time");
    if (!el) return "";
    const text = (el.textContent || el.getAttribute("datetime") || "").trim();
    return text.replace(/^编辑于\s*/, "").replace(/^发布于\s*/, "");
  }

  function getTitle() {
    const h1 = document.querySelector("h1.Post-Title, .Post-Title");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    const q = document.querySelector(".QuestionHeader-title, h1.QuestionTitle");
    if (q && q.textContent.trim()) {
      const qt = q.textContent.trim();
      const author = getAuthor();
      return author ? qt + " - " + author + "的回答" : qt;
    }
    const t = document.title.replace(/\s*[-–—]\s*知乎.*$/, "").trim();
    return t || "知乎文章";
  }

  function imageExtension(url) {
    try {
      const m = new URL(url).pathname.match(/\.(gif|png|jpe?g|webp|svg)(?=$|\?)/i);
      if (m) {
        const ext = m[1].toLowerCase();
        return ext === "jpeg" ? "jpg" : ext;
      }
    } catch (e) { /* ignore */ }
    return "jpg";
  }

  function imgSrc(img) {
    return img.getAttribute("data-actualsrc")
      || img.getAttribute("data-original")
      || img.getAttribute("data-src")
      || img.getAttribute("src") || "";
  }

  function fixLatex(code) {
    if (!code) return "";
    code = code.replace(/\\\{/g, "\\{").replace(/\\\}/g, "\\}");
    code = code.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
    code = code.replace(/\^(\s*)$/g, "^{}");
    code = code.replace(/_(\s*)$/g, "_{}");
    code = code.replace(/(\^|_)\s*(\\color\{[^}]+\})\s*(\{[^}]+\}|\\[a-zA-Z]+|[a-zA-Z0-9+\-])/g, "$1{$2$3}");
    code = code.replace(/\\uwave/g, "\\underline").replace(/\\xout/g, "\\cancel");
    return code.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // MathJax 源码: 从扩展包读取一次并缓存(用于内嵌进 HTML, 彻底摆脱网络/路径依赖)
  // 读取双保险: ① 直接 fetch 扩展资源(已声明 web_accessible_resources)
  //            ② 通过后台消息读取(后台 Service Worker 读自己资源不受限制)
  let mathjaxSrcPromise = null;
  function getMathjaxSource() {
    if (!mathjaxSrcPromise) {
      mathjaxSrcPromise = fetch(chrome.runtime.getURL("lib/tex-svg-full.js"))
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => chrome.runtime.sendMessage({ type: "getMathjax" })
          .then((res) => (res && res.ok ? res.text : ""))
          .catch(() => ""))
        .then((code) => code
          // 内嵌到 <script> 里的安全转义:
          .replace(/<\/script/gi, "<\\/script")  // 防止提前闭合 script 标签
          .replace(/<!--/g, "<\\!--"))            // 防止 HTML 解析器进入注释转义状态
        .catch(() => "");
    }
    return mathjaxSrcPromise;
  }

  // MathJax 配置(简化: tex-svg-full.js 已内置全部扩展, 无需 packages, 避免加载扩展出错)
  function mathjaxConfigBlock() {
    return "<script>\n"
      + "MathJax = {\n"
      + "  tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] },\n"
      + "  svg: { fontCache: 'global' }\n"
      + "};\n"
      + "</script>\n";
  }

  // 仅在内嵌源码读取失败(几乎不可能)时的兜底加载链: npmmirror → 压缩包本地 → jsdelivr
  function mathjaxFallbackBlock() {
    return "<script>\n"
      + "function __mjFallback(){\n"
      + "  var s=document.createElement('script');\n"
      + "  s.src='https://registry.npmmirror.com/mathjax/3.2.2/files/es5/tex-svg-full.js';\n"
      + "  s.onerror=function(){\n"
      + "    var s2=document.createElement('script');\n"
      + "    s2.src='_mathjax/tex-svg-full.js';\n"
      + "    s2.onerror=function(){\n"
      + "      var s3=document.createElement('script');\n"
      + "      s3.src='https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js';\n"
      + "      s3.async=true;document.head.appendChild(s3);};\n"
      + "    s2.async=true;document.head.appendChild(s2);};\n"
      + "  s.async=true;document.head.appendChild(s);\n"
      + "}\n"
      + "</script>\n"
      + "<script>__MATHJAX_INLINE__</script>\n";
  }

  const EXPORT_STYLE = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
           line-height: 1.8; max-width: 900px; margin: 0 auto; padding: 2em; color: #333; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
    h1, h2, h3 { color: #111; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { background: rgba(27,31,35,.05); padding: .2em .4em; border-radius: 3px; }
    blockquote { border-left: 4px solid #dfe2e5; padding-left: 1em; color: #6a737d; margin-left: 0; }
    table { border-collapse: collapse; margin: 12px 0; }
    td, th { border: 1px solid #ddd; padding: 6px 10px; }
    mjx-container[jax="SVG"] { display: inline-block; }
  `;

  // 把公式节点替换为 LaTeX(HTML 由 MathJax 重新渲染, 不依赖知乎页面内的 SVG)
  function mathToLatex(root) {
    for (const span of root.querySelectorAll("span.ztext-math")) {
      const tex = span.getAttribute("data-tex");
      if (!tex) continue;
      const latex = fixLatex(tex);
      const out = span.getAttribute("data-block")
        ? "\n$$\n" + latex + "\n$$\n" : " $" + latex + "$ ";
      const node = document.createTextNode(out);
      span.replaceWith(node);
    }
    for (const img of root.querySelectorAll("img.eeimg")) {
      const tex = img.getAttribute("alt");
      if (!tex) continue;
      const node = document.createTextNode(" $" + fixLatex(tex) + "$ ");
      img.replaceWith(node);
    }
  }

  // 提取整页 → 返回 Markdown / HTML(相对路径 + MathJax) / 打印 HTML / 图片清单
  function extract() {
    const content = pick();
    if (!content) return null;

    const title = getTitle();
    const author = getAuthor();
    const date = getDate();
    const safeTitle = sanitize(title);

    const clone = content.cloneNode(true);

    clone.querySelectorAll(
      "script, style, noscript, button, .RichContent-actions, .ContentItem-actions, " +
      ".AnswerItem-extraInfo, .VoteButton, [data-draft-type], .CopyrightRichText-tooltip, " +
      ".Post-Author, .ContentItem-rightButton, .RichContent-cover, .KfeCollection-AnswerTopCard-Container"
    ).forEach((n) => n.remove());

    // 图片: 替换为 ../assets/... 相对路径并记录下载清单(跳过 data: 内联图和头像)
    const images = [];
    let idx = 0;
    for (const img of clone.querySelectorAll("img")) {
      if (img.classList.contains("eeimg") && img.getAttribute("alt")) continue;
      if (img.classList.contains("Avatar")) continue;
      let src = imgSrc(img);
      if (!src) continue;
      if (src.startsWith("data:")) continue; // 内联图保持原样
      try {
        src = new URL(src, location.href).href; // 相对地址补全
      } catch (e) {
        continue;
      }
      if (!/^https?:/i.test(src)) continue;
      idx += 1;
      const name = "img_" + String(idx).padStart(3, "0") + "." + imageExtension(src);
      images.push({ url: src, name });
      // ZIP 内 md/html 与 assets 同级, 相对路径直接 assets/...(不再上跳)
      img.setAttribute("src", "assets/" + safeTitle + "/" + name);
      img.setAttribute("data-orig-src", src); // 记住原网址(打印页还原用)
      ["data-actualsrc", "data-original", "data-src", "srcset", "data-lazy-status"].forEach(
        (attr) => img.removeAttribute(attr));
    }

    // 知乎部分"动图"实际是 <video>: 取 poster 封面转成静态图进 PDF/导出; 无封面的移除
    for (const video of clone.querySelectorAll("video")) {
      let poster = video.getAttribute("poster") || "";
      if (poster && !poster.startsWith("data:")) {
        try {
          poster = new URL(poster, location.href).href;
        } catch (e) {
          poster = "";
        }
      }
      if (poster && /^https?:/i.test(poster)) {
        idx += 1;
        const name = "img_" + String(idx).padStart(3, "0") + "." + imageExtension(poster);
        images.push({ url: poster, name });
        const img = document.createElement("img");
        img.setAttribute("src", "assets/" + safeTitle + "/" + name);
        img.setAttribute("data-orig-src", poster); // 打印页还原原图用
        video.replaceWith(img);
      } else {
        video.remove();
      }
    }

    // ---- Markdown(公式占位符保护, 转换后还原) ----
    const mdClone = clone.cloneNode(true);
    const mathMap = new Map();
    let ph = 0;
    for (const span of mdClone.querySelectorAll("span.ztext-math")) {
      const tex = span.getAttribute("data-tex");
      if (!tex) continue;
      const latex = fixLatex(tex);
      const out = span.getAttribute("data-block")
        ? "\n$$\n" + latex + "\n$$\n" : " $" + latex + "$ ";
      const placeholder = "PLACEHOLDERMATH" + (ph++);
      mathMap.set(placeholder, out);
      span.replaceWith(document.createTextNode(placeholder));
    }
    for (const img of mdClone.querySelectorAll("img.eeimg[alt]")) {
      const tex = img.getAttribute("alt");
      if (!tex) continue;
      const placeholder = "PLACEHOLDERMATH" + (ph++);
      mathMap.set(placeholder, " $" + fixLatex(tex) + "$ ");
      img.replaceWith(document.createTextNode(placeholder));
    }

    if (typeof TurndownService === "undefined") {
      return { ok: false, error: "转换库未加载, 请在扩展管理页重新加载本扩展后再试" };
    }
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
    if (typeof turndownPluginGfm !== "undefined") {
      td.use(turndownPluginGfm.gfm);
    }
    let mdBody = td.turndown(mdClone);
    for (const [placeholder, latex] of mathMap) {
      mdBody = mdBody.replace(placeholder, latex);
    }

    let yaml = "---\n";
    yaml += 'title: "' + title.replace(/"/g, "'") + '"\n';
    yaml += 'author: "' + (author || "未知").replace(/"/g, "'") + '"\n';
    yaml += "date: " + (date || "1970-01-01") + "\n";
    yaml += "tags: [知乎备份]\n";
    yaml += 'url: "' + location.href + '"\n';
    yaml += "---\n\n";
    const md = yaml + "# " + title + "\n\n" + mdBody;

    // ---- HTML 导出: 公式换 LaTeX + MathJax 重新渲染(离线优先) ----
    mathToLatex(clone);

    // ---- 打印 HTML: 原图网址 + LaTeX 公式(打印页自带 MathJax) ----
    const printClone = clone.cloneNode(true);
    for (const img of printClone.querySelectorAll("img")) {
      const orig = img.getAttribute("data-orig-src") || imgSrc(img);
      if (orig && orig.startsWith("http")) {
        img.setAttribute("src", orig);
      }
      img.removeAttribute("data-orig-src");
    }
    const printHtml = "<h1>" + escapeHtml(title) + "</h1>\n" + printClone.innerHTML;

    // 保存版 HTML: 去掉临时属性
    for (const img of clone.querySelectorAll("img")) {
      img.removeAttribute("data-orig-src");
    }
    const htmlHead = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<title>"
      + escapeHtml(title) + "</title>\n" + mathjaxConfigBlock() + mathjaxFallbackBlock()
      + "<style>" + EXPORT_STYLE + "</style>\n</head>\n<body>\n";
    const html = htmlHead + "<h1>" + escapeHtml(title) + "</h1>\n"
      + clone.innerHTML + "\n</body>\n</html>";

    return { title, safeTitle, md, html, printHtml, images };
  }

  // 等待正文出现(知乎为前端渲染, 打开页面后正文异步加载)
  function waitForContent(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 15000);
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (pick()) { clearInterval(timer); resolve(true); }
        else if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
      }, 500);
    });
  }

  // 完整的自包含打印 HTML(用于 PDF 方案①): DOCTYPE + 内嵌 MathJax 源码 + 绝对图片 URL
  // + 渲染完成标记脚本。不依赖扩展页面/CSP/外部文件, 公式必定渲染。
  function buildPrintFullHtml(title, bodyHtml, mathjaxCode) {
    const readyScript = "<script>\n"
      + "(function(){\n"
      + "  var done=false;\n"
      + "  function markReady(){if(done)return;done=true;"
      + "document.body.setAttribute('data-mathjax-ready','1');}\n"
      + "  window.addEventListener('load',function(){\n"
      + "    if(window.MathJax&&window.MathJax.startup&&window.MathJax.typesetPromise){\n"
      + "      MathJax.startup.promise.then(function(){return MathJax.typesetPromise();})"
      + ".then(markReady).catch(markReady);\n"
      + "    }else{markReady();}\n"
      + "  });\n"
      + "  setTimeout(markReady,15000);\n"
      + "})();\n"
      + "</script>\n";

    let mathjaxScript;
    if (mathjaxCode) {
      // 内嵌完整 MathJax 源码(已做 </script 与 <!-- 安全转义)
      mathjaxScript = "<script>" + mathjaxCode + "</script>\n";
    } else {
      // 源码读取失败兜底: CDN 链(npmmirror → jsdelivr)
      mathjaxScript = "<script>\n"
        + "function __mjCdn(){\n"
        + "  var s=document.createElement('script');\n"
        + "  s.src='https://registry.npmmirror.com/mathjax/3.2.2/files/es5/tex-svg-full.js';\n"
        + "  s.onerror=function(){var s2=document.createElement('script');"
        + "s2.src='https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg-full.js';"
        + "s2.async=true;document.head.appendChild(s2);};\n"
        + "  s.async=true;document.head.appendChild(s);\n"
        + "}\n__mjCdn();\n"
        + "</script>\n";
    }

    // 注意: bodyHtml(data.printHtml) 已包含 <h1> 标题, 这里不再重复添加
    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<title>"
      + escapeHtml(title) + "</title>\n"
      + mathjaxConfigBlock() + mathjaxScript + readyScript
      + "<style>" + EXPORT_STYLE + "</style>\n</head>\n<body>\n"
      + bodyHtml + "\n</body>\n</html>";
  }

  async function exportArticle(formats) {
    const data = extract();
    if (data && data.ok === false) return data;
    if (!data) {
      return { ok: false, error: "未找到文章正文(请确认当前页是知乎文章/回答, 且已展开全文)" };
    }

    // 把 MathJax 完整源码内嵌进 HTML(离线/无依赖, 公式必定渲染); 读取失败时走 CDN 兜底链
    let mathjaxCode = "";
    if (formats.html || formats.pdf) {
      mathjaxCode = await getMathjaxSource();
      if (!mathjaxCode) {
        console.warn("[Dadealbit] MathJax 源码读取失败, 公式将尝试 CDN 加载");
      }
    }
    if (formats.html) {
      data.html = data.html.replace("__MATHJAX_INLINE__", mathjaxCode || "__mjFallback();");
    }

    // PDF 方案①用: 完整自包含打印 HTML(内嵌 MathJax + 绝对图片 URL)
    const printFullHtml = formats.pdf
      ? buildPrintFullHtml(data.title, data.printHtml, mathjaxCode)
      : null;

    // 后台统一处理: 静默生成 PDF(可选) + offscreen 打包 zip 下载
    const res = await chrome.runtime.sendMessage({
      type: "exportZip",
      title: data.title,
      md: formats.md ? data.md : null,
      html: formats.html ? data.html : null,
      images: data.images,
      pdf: !!formats.pdf,
      printHtml: data.printHtml,      // 内容片段(方案②③的打印页用)
      printFullHtml,                  // 完整自包含 HTML(方案①用)
    });

    return {
      ok: !!(res && res.ok),
      error: res && res.error,
      title: data.title,
      filename: res && res.filename,
      imagesOk: res && res.imagesOk,
      imagesTotal: res && res.imagesTotal,
      pdfOk: !!(res && res.pdfOk),
      pdfError: res && res.pdfError,
      pdf: !!formats.pdf,
    };
  }

  // 左下角浮动小按钮: 点击唤起插件主界面(弹窗); 打不开时直接按已保存格式一键提取
  function injectFloatingButton() {
    if (!isTargetPage()) return;
    if (document.getElementById("dadealbit-fab")) return;
    const btn = document.createElement("button");
    btn.id = "dadealbit-fab";
    btn.type = "button";
    btn.textContent = "⬇️ 提取";
    btn.title = "Dadealbit 提取: 点击打开主界面";
    btn.style.cssText = [
      "position:fixed", "left:20px", "bottom:20px", "z-index:2147483647",
      "padding:10px 16px", "border:none", "border-radius:22px",
      "background:linear-gradient(#3d7fb8,#2e6392)", "color:#fff",
      "font-size:13px", "font-family:'Microsoft YaHei',sans-serif",
      "cursor:pointer", "box-shadow:0 4px 14px rgba(0,0,0,0.28)",
      "opacity:0.92",
    ].join(";");
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.92"; });
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "openPopup" })
        .then((res) => {
          if (res && res.ok) return; // 主界面已打开
          // 打开弹窗失败(无用户手势等情况) → 直接按已保存格式提取
          chrome.storage.local.get("formats").then((d) => {
            const formats = d.formats || { md: true, html: true, pdf: false };
            btn.textContent = "⏳ 提取中...";
            exportArticle(formats).then((r) => {
              btn.textContent = r.ok ? "✅ 已导出" : "❌ 失败";
              setTimeout(() => { btn.textContent = "⬇️ 提取"; }, 2500);
            }).catch(() => {
              btn.textContent = "❌ 失败";
              setTimeout(() => { btn.textContent = "⬇️ 提取"; }, 2500);
            });
          });
        })
        .catch(() => { /* 扩展上下文失效, 忽略 */ });
    });
    document.documentElement.appendChild(btn);
  }

  // 右下角进度浮窗: 告诉使用者现在在干什么
  let toastEl = null;
  let toastTimer = null;
  function showToast(text, done) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "dadealbit-toast";
      toastEl.style.cssText = [
        "position:fixed", "right:20px", "bottom:20px", "z-index:2147483647",
        "max-width:360px", "padding:12px 16px", "border-radius:10px",
        "background:rgba(20,40,60,0.92)", "color:#eaf4fb", "font-size:13px",
        "font-family:'Microsoft YaHei',sans-serif", "line-height:1.5",
        "box-shadow:0 6px 20px rgba(0,0,0,0.3)",
      ].join(";");
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = "none"; }, done ? 7000 : 15000);
  }

  // 获取本标签页 id(用于只显示本页提取任务的进度)
  let myTabId = null;
  chrome.runtime.sendMessage({ type: "whoami" })
    .then((r) => { myTabId = (r && r.tabId != null) ? r.tabId : null; })
    .catch(() => {});

  // popup → 当前页提取
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "extract") {
      exportArticle(msg.formats || { md: true, html: true, pdf: false })
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type === "progress") {
      // 只显示本标签页提取任务的进度
      if (msg.tabId == null || myTabId == null || msg.tabId === myTabId) {
        showToast(msg.text, msg.done);
      }
    }
    return false;
  });

  // 批量模式: 页面加载完成后自动提取并自报 batchDone(由后台关闭标签页)
  (async function autoBatch() {
    injectFloatingButton();
    if (!isTargetPage()) return;
    const data = await chrome.storage.session.get(["batchActive", "batchCount"]);
    if (!data.batchActive) return;
    const formats = await chrome.storage.local.get("formats");
    const f = formats.formats || { md: true, html: true, pdf: false };
    await waitForContent(20000);
    try {
      const r = await exportArticle(f);
      console.log("[Dadealbit] 批量提取:", r.ok ? r.title : r.error);
    } catch (e) {
      console.warn("[Dadealbit] 批量提取失败:", e);
    }
    const remaining = (Number(data.batchCount) || 1) - 1;
    if (remaining <= 0) {
      await chrome.storage.session.remove(["batchActive", "batchCount"]);
    } else {
      await chrome.storage.session.set({ batchCount: remaining });
    }
    chrome.runtime.sendMessage({ type: "batchDone" });
  })();

  // 知乎是单页应用(站内跳转不刷新页面), 定时检查确保浮动按钮始终出现在文章/回答页
  setInterval(() => {
    try {
      injectFloatingButton();
    } catch (e) { /* ignore */ }
  }, 2000);
})();
