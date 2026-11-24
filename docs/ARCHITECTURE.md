# 架构

## 目标

Windows 上打开并放映 PPT / PPTX / PPS / ODP / PDF，全屏演示带左右导航与底部工具栏。
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

## 转换引擎

优先顺序：设置里的显式路径 → 内置 `resources/lo` → 注册表 → `PATH`。
调用方式：

```
soffice.com --headless --norestore --invisible --nologo
  -env:UserInstallation=file:///<临时目录>/lo-<uuid>
  --convert-to pdf:impress_pdf_Export --outdir <缓存目录> "<源文件>"
```

每次转换使用独立 profile 目录，避免并发锁冲突；超时用 `taskkill /PID <pid> /T /F` 清理进程树。
LibreOffice 失败时也可能返回 0，因此成功判据是「输出存在且页数 > 0」。

## 缓存

```
userData/cache/<sha256[0:16]>/{deck.pdf, meta.json}
```

键包含源文件路径、大小、mtime、引擎标识与引擎路径、应用版本。任一项变化都会重新转换。
`meta.json` 记录 `pageCount`，为 0 的条目视为无效。超过预算按最近最少使用淘汰。

## 格式识别（只看内容，不看扩展名）

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

## 已知边界

- 不重放动画、音频、视频、超链接与切换效果：放映的是静态页面。
- 加密文稿需要本机 PowerPoint，内置引擎无法解密。
- 墨迹只在会话内保存，不写回源文件。
- 构建与测试全部在 GitHub Actions 的 `windows-latest` 上执行。
