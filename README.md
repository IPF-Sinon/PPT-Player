# PPT Player

Windows 桌面放映器。打开 PPT / PPTX / PPS / ODP / PDF，全屏演示，带左右导航栈与底部浮动工具栏。
**不依赖本机 Office**：安装包内置 LibreOffice 引擎，离线可用。

## 特性

- 内容识别格式，不看扩展名；扩展名与实际不符时会提示
- PPTX 走原生渲染：不解压、不转换、毫秒级打开，支持点击动画
- 旧版 PPT / ODP 走内置 LibreOffice 转 PDF 后渲染，可一键在两种模式间切换
- 进入放映不重开窗口、不重载 PDF，复用已挂载的文档
- 批注与白板共用一套绘制内核，切回指针后笔迹保留
- 多标签页：同窗口切换多份文稿，去重、可关闭
- 预览页：缩略图栏、舞台、拖放打开、最近文件、醒目的「开始放映」
- 放映页：与预览同一窗口，切全屏即放映；半透明悬浮工具栏、批注（颜色/粗细/撤销/清空）、
  独立白板、页码指示、快捷键
- 点击步进动画：题目先出，按下一页才显示答案/解析（原生引擎）
- 转换结果按文件指纹缓存，可设上限，超出按最近最少使用淘汰

## 构建

全部在 GitHub Actions 的 `windows-latest` 上执行，本地不产出构建物。

```bash
pnpm install
pnpm typecheck   # 主进程 + 渲染进程
pnpm lint
pnpm test        # 单元测试
pnpm build       # 打包前构建
pnpm package     # NSIS 安装包 + zip（需要内置引擎）
```

引擎由 `scripts/build-engine.ps1` 生成：下载 LibreOffice MSI、管理安装解包、裁剪、
自包含化 VC++ 运行时、跑冒烟转换，最后压成 zip 供打包使用。

裁剪不靠经验删文件：每个候选文件都先删掉、跑一次真实 pptx→PDF 转换，失败就还原。
冒烟环节用 pdf.js 解析产出的 PDF，断言页数正确且首页有实际绘制内容，所以裁剪
不可能悄悄破坏渲染。详见 [docs/COMPAT.md](docs/COMPAT.md)。

## 发布

打 tag 即可，或用 `workflow_dispatch` 指定 tag：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`release.yml` 会先复用 `ci.yml` 跑完整校验，再由 publish 作业打包并上传
NSIS 安装包、免安装 zip 和 `sha256sums.txt`。默认直接发布，`draft` 输入可改成草稿。
tag 必须与 `package.json` 的版本一致，否则构建失败。

## 目录

```
src/main/convert/   格式识别、引擎调用、缓存、转换流水线
src/main/ipc/       IPC 处理器、app:// 协议、参数校验
src/renderer/       预览页与放映页（React）
src/shared/         跨进程类型、错误码、中文文案
scripts/            引擎构建、fixture 生成、图标生成、pdf.js 资源拷贝
docs/               架构、兼容性、界面规格
```

## 文档

- [架构](docs/ARCHITECTURE.md)
- [兼容性](docs/COMPAT.md)
- [界面规格](docs/UI-SPEC.md)

## 许可

MIT