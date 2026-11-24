# PPT Player

Windows 桌面放映器。打开 PPT / PPTX / PPS / ODP / PDF，全屏演示，带左右导航栈与底部浮动工具栏。
**不依赖本机 Office**：安装包内置 LibreOffice 引擎，离线可用。

## 特性

- 内容识别格式，不看扩展名；扩展名与实际不符时会提示
- 统一转 PDF 后渲染，预览与放映共用同一份产物
- 预览页：缩略图栏、舞台、信息抽屉、拖放打开、最近文件
- 放映页：全屏、双侧导航、底部工具条、黑屏/白屏、总览、放大镜、墨迹、快捷键
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
