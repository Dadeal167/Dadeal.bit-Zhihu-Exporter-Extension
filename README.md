# Dadeal.bit知乎内容提取器

* * *

与桌面版同源的浏览器插件。
插件直接在你**已登录的浏览器**里读取页面内容，因此：

- ✅ **不需要登录配置**（用浏览器当前登录态）
- ✅ **不受桌面版风控/403 影响**（你就是真实浏览器会话）
- ✅ **每篇文章自动打包一个 zip**：Markdown + HTML + **PDF（静默生成，不弹打印框）** + 图片 + MathJax
- ✅ 知乎文章/回答页面**左下角有浮动按钮**，点击唤起插件主界面
- ✅ zip 内 md/html/pdf 与 `assets/`（图片）`_mathjax/`（公式离线渲染）平级，图片相对路径统一 `assets/...`，打开即显示

## 功能

| 功能 | 说明 |
|---|---|
| 提取当前页 | 一键打包 zip（Markdown + HTML + 可选 PDF + 图片 + MathJax） |
| PDF | **三级静默方案**：① chrome.debugger 的 Page.printToPDF（完整自包含 HTML：内嵌 MathJax + 图片预下载转 base64 内嵌 + CDP 强制知乎 Referer，公式图片双重保险、零网络依赖）→ ② 前端库 html2canvas+jsPDF → ③ 打印页手动兜底 |
| 进度提示 | 页面右下角浮窗实时显示当前步骤（提取正文 → 生成 PDF → 下载图片 n/m → 打包 → 保存） |
| 完成通知 | 提取结束后弹出系统通知，点击通知直接打开下载文件夹 |
| 批量提取 | 粘贴多个链接（每行一个），自动开标签页逐个打包 zip，完成后自动关闭 |
| 浮动按钮 | 文章/回答页左下角「⬇️ 提取」按钮，点击打开主界面（打不开时直接按已保存格式提取） |
| 图片 | 后台带知乎 Referer 抓原图打进 zip，HTML/Markdown 相对路径引用，离线可看 |
| 公式 | Markdown 还原 `$...$`；HTML 内**直接内嵌 MathJax 完整源码**（单个 HTML 文件单独拷走也能渲染公式，完全离线、无网络/路径依赖）；PDF 渲染前等待公式完成 |

## 安装（Edge）

1. 打开 `edge://extensions`
2. 打开右上角「**开发人员模式**」开关
3. 点击「**加载解压缩的扩展**」→ 选择本文件夹（`browser_extension`）
4. （如已装过旧版）点扩展卡片上的「**重新加载**」按钮

## 安装（Chrome）

1. 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本文件夹

## 使用

1. 打开知乎文章（`zhuanlan.zhihu.com/p/xxx`）或回答（`www.zhihu.com/question/xxx/answer/xxx`）
2. 点**页面左下角浮动按钮**，或工具栏的插件图标
3. 勾选格式（默认 Markdown + HTML）→ 「提取当前页(打包 zip)」
4. 下载文件夹得到 `知乎导出/<标题>.zip`

解压结构（平铺，md/html/pdf 与 assets 同级，图片路径统一 `assets/...`，MD/HTML 打开即可显示图片）：
```
<标题>.zip
├── <标题>.md                  # 图片引用 assets/<标题>/img_001.png
├── <标题>.html                # 公式内嵌 MathJax 渲染, 图片引用 assets/...
├── <标题>.pdf                 # 勾选 PDF 时
├── assets/<标题>/img_001.png  # 文章图片(含视频动图封面)
└── _mathjax/tex-svg-full.js   # 公式渲染引擎(内嵌失败时的本地兜底)
```

## 权限说明（为什么需要这些权限）

| 权限 | 用途 |
|---|---|
| `downloads` | 下载打包好的 zip |
| `debugger` | **静默生成 PDF**（调用浏览器打印引擎 Page.printToPDF，不弹打印框） |
| `offscreen` | 在隐藏页面里完成 zip 打包与下载（后台线程限制，必需） |
| `tabs` | 批量提取自动开关标签页 |
| `storage` | 记住你勾选的格式 |
| 知乎域名 | 读取页面内容、抓取图片 |

## 已知限制

- 静默 PDF 第①级（debugger）运行期间，浏览器会短暂出现「正在调试此浏览器」提示条，生成完自动消失；若第①级在你的环境不可用，会自动切到第②级前端库方案（图片为高清截图、文字非矢量），全程同样不弹窗。
- 若某篇文章的图片被知乎 CDN 拒绝抓取，该图会缺失（结果里显示「图片 n/m」）。
- 知乎"动图"分两类：GIF 保留原图（PDF 显示第一帧）；`<video>` 视频动图提取为**静态封面图**（播放按钮覆盖层已清理，不再有黑圈）。
- 极老文章的公式是图片形式（`img.eeimg`），Markdown 中还原为 LaTeX，HTML/PDF 保持图片原样。
- 批量防风控：每篇之间随机休眠 3~8 秒；触发安全验证时会明确提示，请先在页面手动完成验证再继续。
- **免责声明**：本工具仅供个人备份使用，请勿用于商业抓取或大规模采集；新注册/空白账号批量操作更容易触发知乎风控，建议使用常用账号、控制每批数量（≤ 20）。

## 目录结构

```
browser_extension/
├── manifest.json          # MV3 配置(Chrome/Edge 通用)
├── background.js          # 静默 PDF(debugger) / offscreen 调度 / 批量开标签
├── offscreen.html/js      # 抓图 + JSZip 打包 + Blob URL 下载(后台线程不支持)
├── content.js             # 页面提取(标题/作者/正文/图片/公式) + 左下角浮动按钮
├── popup.html / popup.js  # 弹窗主界面
├── print.html / print.js  # PDF 渲染页(静默模式 + 手动兜底模式)
├── lib/                   # Turndown / JSZip / MathJax 完整版(均本地打包)
├── icons/                 # 图标
└── make_icons.py          # 图标生成脚本(可选)
```
