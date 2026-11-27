# 架构

## 目标

Windows 上打开并放映 PPT / PPTX / PPS / ODP / PDF，全屏演示带半透明悬浮工具栏。
不依赖本机安装 Office：安装包内置 LibreOffice 引擎，离线可用。

## 双引擎渲染

常规 `.pptx / .ppsx / .pptm / .potx` 走**原生引擎**：不解压、不转换，主进程索引 ZIP 后
由渲染进程直接绘制 OOXML，**支持点击步进动画**。

旧版 `.ppt / .pps`、`.odp`、以及用户手动切换的「兼容模式」走**转换引擎**：先归一为 PDF，
再由 pdf.js 渲染到 canvas。

两条路径共用同一个放映舞台、批注层、白板与工具栏，所以观感一致。

```
源文件 ──探测──┬── PDF ─────────────────────────────────────────► pdf.js ──► canvas
               │
               ├── PPTX / PPSX / PPTM / POTX ──索引 ZIP──► app://pptx/<deckId>/<part>
               │                                            │
               │                                    渲染进程解析 OOXML ──► DOM
               │                                    p:timing ──► 点击步进
               │
               ├── ODP / 旧版 PPT ──soffice──► cache/deck.pdf ──► pdf.js
               │
               └── 加密 OOXML ──拒绝（需 PowerPoint）
```

### 原生引擎为什么快

索引只读文件尾的 EOCD 与中央目录，因此**代价与文件大小无关**：一个 3MB 媒体包和一个
几十 KB 的小文件，索引耗时都在毫秒级（测试里有断言）。幻灯片按需解析，打开一份
百页文稿只解析第一页。

### 动画模型

`p:timing` 被解析成「点击步」列表，每步包含若干效果。求值是**绝对**的：给定步号，
算出哪些元素可见。因此后退与前进同样精确，不需要回放历史。

支持四类效果：**进入**、**退出**、**强调**、**路径运动**。

路径运动（`p:animMotion`）的坐标是幻灯片宽高的归一化比例，解析时换算成像素并转成
SVG path。渲染时用离屏 `SVGPathElement` 采样，因此曲线按真实几何走，而不是折线近似。

**触发器链**（`interactiveSeq`）按按钮形状分轨道：点按钮 A 只推进 A 的轨道，不会翻页
也不会揭示 B 的答案。触发器指向的元素在初始态一律隐藏，否则答案在按下按钮前就已经在屏幕上。

这里有两个只有用真实文稿测试才会暴露的坑：

1. `nodeType="mainSeq"` 在 `p:seq` **内部**的 `p:cTn` 上，不在 `p:seq` 上。
   查错位置会让整份文稿的动画静默失效。
2. 一次点击同时写 `p:set` 与 `p:animEffect`，两者都指向同一形状。不按 target 去重
   会把一次点击算成两个效果，动画时长翻倍。

```
源文件 ──索引──► slidePaths ──按需解析──► SlideModel{elements, steps}
                                              │
                                   步号 ──► evaluateStep ──► 可见集合 + 本次动画
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

## 转换引擎（兼容模式）

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
- **PDF 路径**：布局尺寸只由 CSS 决定，JS 只设置 canvas 的物理分辨率。若由 JS 按测量值
  设置 CSS 尺寸，会形成「画布变大 → 容器变大 → 画布更大」的反馈循环。
- **原生路径**：幻灯片始终按自身逻辑尺寸（如 960×540）排版，用一个 transform 缩放进容器。
  这样文字换行在任何缩放下都一致。缩放比来自测量**外层容器**，是单向依赖，不会反过来
  撑大自己。
- 批注层常驻挂载，仅在非绘制状态设 `pointer-events: none`，因此切回指针工具不会清空笔迹。
- 批注与白板共用 `lib/stroke-canvas.ts` 绘制内核：单点画圆点、`pointermove` 原地追加坐标
  （避免每帧数组拷贝）、线宽按 DPR 缩放。

## 多标签页

`tabs: TabItem[]` + `activeTabId`，每个标签独立持有引擎模式、文档、批注与页码。
同路径（Windows 忽略大小写）打开会聚焦已有标签而不是新建。关闭标签时释放该标签的
`PDFDocumentProxy`、取消未完成的转换，并关闭主进程里的 ZIP 句柄——否则 Windows
会一直锁着源文件。

## 幻灯片转场

`p:transition` 解析出类型、方向与时长（优先取 `p14:dur` 毫秒值）。放映翻页时短暂同时
挂载离场层与进场层，转场结束卸载离场层。

快速连按由「新的导航立即清除上一转场」保证：不会排队，也不会残留旧页。设置里可关闭，
关闭后一律瞬切；预览页切页永远无转场，保持零延迟。

## 双版本发布

| 变体 | 内置引擎 | 体积 | 适用 |
| --- | --- | --- | --- |
| Full | 是 | ~211 MB | 无网教室、会议室电脑 |
| Lite | 否，按需下载 | ~75 MB | 日常只播 `.pptx`/`.pdf` |

Lite 版首次打开 `.ppt`/`.odp` 或切兼容模式时提示一键下载引擎（约 130 MB）。
下载边写盘边算 SHA256，校验不过立即删除；解压到暂存目录，成功后才原子移入
`userData/engine/lo`，因此失败的安装不会留下一个"看起来有效"的半成品。

引擎查找顺序：手动覆盖 → 应用内置 → 下载目录 → 注册表 → `PATH`。

## 日志

主进程日志写到 `userData/logs/main.log`，超过 5 MB 轮转为 `main.old.log`。
转换模块保持 Electron 无关以便单测，通过 `setLogSink()` 在启动时接入文件日志，
因此 `soffice` 的参数、耗时与 stderr 都会落盘。

## 已知边界

- **原生引擎**支持点击步进动画（进入/退出/强调，形状级与段落级）。不支持动画路径、
  触发器链、以及切换效果（转场）。
- **兼容模式**不重放任何动画：放映的是静态页面。
- 音频、视频、超链接在两条路径下都不重放。
- SmartArt、图表、公式、OLE 对象与 EMF 图元在原生引擎下不渲染；检测到时顶栏提示
  「复杂元素」，可一键切到兼容模式。
- 加密文稿需要本机 PowerPoint，内置引擎无法解密。
- 墨迹只在会话内保存，不写回源文件。
- 构建与测试全部在 GitHub Actions 的 `windows-latest` 上执行。