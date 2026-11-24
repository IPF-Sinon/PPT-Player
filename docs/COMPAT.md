# 兼容性

## 支持范围

| 格式 | 识别 | 转换 | 备注 |
| --- | --- | --- | --- |
| `.pptx` | 内容 | LibreOffice | 主力格式 |
| `.pptm` | 内容 | LibreOffice | 宏不执行 |
| `.ppsx` / `.ppsm` | 内容 | LibreOffice | 直接进入放映语义 |
| `.potx` | 内容 | LibreOffice | 按普通文稿打开 |
| `.ppt` / `.pps` | 内容 | LibreOffice | 旧二进制格式 |
| `.odp` | 内容 | LibreOffice | OpenDocument |
| `.pdf` | 内容 | 直通 | 不经过引擎 |
| 加密 OOXML | 内容 | 不支持 | 需本机 PowerPoint |

单文件上限 200 MB。超出直接拒绝，不尝试部分加载。

## 排版还原度

转换由 LibreOffice 完成，与 PowerPoint 的差异集中在：

- **字体**：源文件使用的商用字体若未安装，会回退到度量接近的替代字体，行距与断行可能位移。
- **SmartArt / 图表**：LibreOffice 会重新绘制，复杂 SmartArt 可能简化。
- **渐变与阴影**：少数混合模式与 PowerPoint 渲染结果不同。
- **艺术字与三维效果**：可能降级为平面图形。

这些差异属于渲染引擎差异，不影响页面数量与顺序。

## 页面尺寸

每页的原始尺寸由 pdf.js 读取并回传主进程。检测到同一文稿内页面宽高比不一致时，
预览页会显示「包含不同比例的页面」提示；放映时每页按自身比例等比缩放，不拉伸。

## 系统要求

- Windows 10 1809 及以上 / Windows 11，x64
- 无需安装 Office、无需安装 LibreOffice（引擎内置）
- 需要可写的用户数据目录（缓存与设置）
## 引擎裁剪

安装包体积几乎全部来自内置的 LibreOffice。裁剪不凭经验删文件，而是
**每个候选文件都做一次真实转换验证**：删掉 → 跑一次 pptx→PDF → 失败就还原。
日志记录哪些被删、哪些被保留。

实测（LibreOffice 25.8.7，administrative install）：

| 阶段 | 解包体积 |
| --- | --- |
| 原始 | 1,500 MB |
| 去掉文档 / 安装包残留 | 1,470 MB |
| 去掉图标主题 | 1,399 MB |
| 去掉模板 / 向导 / Basic | 1,365 MB |
| 去掉 89 MB 非中英本地化资源 | 1,012 MB |
| 去掉非拉丁字体 | 1,003 MB |
| 逐个探测模块与可选组件 | **407 MB** |

**必须保留**（删掉即转换失败，已由探测确认）：`share/config/soffice.cfg`、
`pdfiumlo.dll`、`mwaw.dll`、`wps.dll`、`etonyek.dll`、`CoinMP.dll`。
即使是无头导出，LibreOffice 也会在初始化组件上下文时加载它们。

**可以安全删除**：Calc / Writer / Base / Math 模块、Python 运行时、
`xpdfimport.exe`、Java classes、字典扩展、模板与向导。

## 实测产物

| 产物 | 体积 |
| --- | --- |
| 引擎 zip（压缩后） | 130.3 MB |
| `PPTPlayer-Setup-*-x64.exe`（NSIS 安装版） | 待测 |
| `PPTPlayer-*-x64.zip`（免安装版） | 待测 |

CI 在引擎 zip 超过 160 MB 时直接失败，防止裁剪回退。
