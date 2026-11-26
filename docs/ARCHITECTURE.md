# 架构

## 目标

Windows 上打开并放映 PPT / PPTX / PPS / ODP / PDF，全屏演示带半透明悬浮工具栏。
不依赖本机安装 Office：安装包内置 LibreOffice 引擎，离线可用。

## 渲染路径：一切先转 PDF

任何格式都先归一为 PDF，再由 pdf.js 渲染到 canvas。缩略图与放映页共用同一份 PDF，
因此「预览所见」与「放映所见」不会分叉。

```
源文件 ──探测──┬── PDF ─────────────────────────────┐
               ├── OOXML / ODP / 旧版 PPT ──soffice──┤
               └── 加密 OOXML ──拒绝（需 PowerPoint） │
                                                    ▼
                                    userData/cache/<key>/deck.pdf
                                                    │
                                     app://deck/<deckId>/deck.pdf
                                                    │
                                          pdf.js ──► canvas
```

## 进程结构

| 层 | 职责 |
| --- | --- |
| 主进程 | 格式探测、引擎调用、缓存、协议、窗口、IPC |
| preload | 只暴露白名单方法，全部走 `ipcRenderer.invoke` |
| 渲染进程 | 预览页 / 放映页，纯前端，无 Node 权限 |

安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、
严格 CSP、`app://` 自定义协议只映射渲染产物与已登记的 deck PDF。

## 单窗口

预览与放映是**同一个窗口的两个视图**。进入放映只是把当前窗口切到全屏
（`win.setFullScreen(true)`），渲染进程通过 `play:state` 事件切换视图。

这样做的原因：早期实现会新开一个 BrowserWindow，等于重新起一个渲染进程、
重新解析 React 与 pdf.js、重新拉取 PDF，用户会看到明显的二次加载。现在进入放映
复用已经挂载的 `PDFDocumentProxy`，切换开销接近 0。

窗口离开全屏（无论是 Esc、F11 还是系统手势）都会推送 `play:state { active: false }`，
避免 UI 停在放映态。

## 转换引擎

优先顺序：设置里的显式路径 → 内置 `resources/lo` → 注册表 → `PATH`。
注册表探测是异步的，且只在真正需要转换非 PDF 文件时才发生。

```
soffice.com --headless --norestore --invisible --nologo
  --nodefault --nofirststartwizard --nolockcheck
  -env:UserInstallation=file:///<userData>/lo-profile/slot-N
  --convert-to pdf:impress_pdf_Export --outdir <缓存目录> "<源文件>"
```

**Profile 复用**：profile 目录在多次转换之间复用（带槽位与 `.lock`），不再每次新建后删除。
每次冷建 profile 会让 LibreOffice 重建配置、字体缓存与扩展注册表，这是首屏「正在转换」
耗时的主要来源。

**stdout 必须丢弃**：`soffice` 会往 stdout 写进度，若该管道无人读取，缓冲区满后
子进程会永久阻塞——这正是「卡在正在转换」的真实原因。因此 `stdio` 为
`['ignore', 'ignore', 'pipe']`，只保留 stderr 用于排障。

**退出判定**：Windows 上 `soffice.com` 会派生 `soffice.bin`，残留孙进程可能继承
stderr 句柄导致 `close` 永不触发。因此以 `exit` 为主信号，并在其后再挂一个
1.5 秒兜底定时器强制结算。

超时 60 秒，可取消：打开新文件或点击取消会 `abort()` 并 `taskkill /T /F` 清理进程树。

## 缓存

```
userData/cache/<sha256[0:16]>/{deck.pdf, meta.json}
```

键包含源文件路径、大小、mtime、引擎标识与引擎路径、应用版本。任一项变化都会重新转换。
页数由**主进程**在转换后直接统计并写入 `meta.json`，不再依赖渲染进程回写——否则
用户在页数上报前关闭窗口，条目就会以 `pageCount: 0` 落盘并在下次被丢弃，导致重复转换。
超过预算按最近最少使用淘汰。

## 格式识别（只看内容，不看扩展名）

探测走随机访问的 `ByteSource`，只读文件头、ZIP 尾部与中央目录，**代价与文件大小无关**。

| 特征 | 判定 |
| --- | --- |
| `%PDF-` | PDF |
| ZIP + `ppt/presentation.xml` | OOXML 演示文稿 |
| ZIP + `mimetype` = ODP MIME | ODP |
| ZIP + `EncryptedPackage` | 加密 OOXML |
| CFB + `PowerPoint Document` | 旧版 PPT |
| CFB + `EncryptionInfo`/`EncryptedPackage` | 加密 OOXML |
| CFB + `WordDocument`/`Workbook` | 拒绝 |

扩展名只用于打标签和提示「实际格式与扩展名不一致」。

> 早期实现对 >64 MB 的文件只读前 8 MB，而 ZIP 的 EOCD 在文件末尾，导致合法大文件
> 一律被判为 `corrupt-zip`。现在尾部与中央目录都是定点读取。

## 放映渲染

- 舞台铺满屏幕：`.slide-frame` 用 `min(100vw, 100vh * ratio)` 计算最大内接矩形，
  16:9 幻灯片在 16:9 屏幕上四边零黑边。
- 布局尺寸只由 CSS 决定，JS 只设置 canvas 的物理分辨率。若由 JS 按测量值设置 CSS 尺寸，
  会形成「画布变大 → 容器变大 → 画布更大」的反馈循环。
- 批注层常驻挂载，仅在非绘制状态设 `pointer-events: none`，因此切回指针工具不会清空笔迹。
- 批注与白板共用 `lib/stroke-canvas.ts` 绘制内核：单点画圆点、`pointermove` 原地追加坐标
  （避免每帧数组拷贝）、线宽按 DPR 缩放。

## 日志

主进程日志写到 `userData/logs/main.log`，超过 5 MB 轮转为 `main.old.log`。
转换模块保持 Electron 无关以便单测，通过 `setLogSink()` 在启动时接入文件日志，
因此 `soffice` 的参数、耗时与 stderr 都会落盘。

## 已知边界

- 不重放动画、音频、视频、超链接与切换效果：放映的是静态页面。
- 加密文稿需要本机 PowerPoint，内置引擎无法解密。
- 墨迹只在会话内保存，不写回源文件。
- 构建与测试全部在 GitHub Actions 的 `windows-latest` 上执行。
