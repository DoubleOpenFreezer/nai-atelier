# macOS 安装版

macOS 版与 [Windows 安装版](./WINDOWS_DESKTOP.md) 共用同一套 Electron 窗口、内置 Node、预构建前端／Worker 与本地 D1／R2 工作区，面向没有开发环境的 Mac 使用者。当前只构建 Apple 芯片（arm64）版本，需要 macOS 12 或更新系统。

## 构建

在 Apple 芯片 Mac 上、已安装 Node 22+ 与 Xcode 命令行工具的源码目录中执行：

```bash
npm ci
npm run build:desktop
```

脚本按本机平台自动选择目标：下载并校验官方 `node-v<版本>-darwin-arm64.tar.gz`，按锁文件安装 macOS 运行依赖（sharp、workerd、ONNX 只保留 darwin-arm64），由 `public/app-icon.png` 生成 `.icns`，产出：

| 文件 | 用途 |
| --- | --- |
| `release/NAI-Atelier-<版本>-mac-arm64.dmg` 与 `.sha256` | 分发用磁盘映像 |
| `release/mac-arm64/NAI Atelier.app` | 解包应用，可直接运行 |

`npm run build:desktop:dir` 只生成 `.app`，不制作 DMG。GitHub 访问不稳定时，可为 Electron 与打包工具设置镜像（下载内容仍按 Electron 自带校验和核对）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run build:desktop
```

## 安装与首次打开

1. 打开 DMG，把 **NAI Atelier** 拖入「应用程序」。
2. 应用只有临时（ad-hoc）签名，没有 Apple 开发者证书与公证。本机构建的应用可直接打开；从网络下载的副本首次打开会被 Gatekeeper 拦截，可在 Finder 中按住 Control 点按应用选择「打开」，或在「系统设置 → 隐私与安全性」点「仍要打开」。不要把临时签名描述为已获得系统信任。
3. 在「NovelAI 与 Anlas」配置自己的 Key，在「Tag 补全词库」安装词库。

关闭窗口（⌘W 或红色按钮）只收进后台，局域网服务继续运行；从 Dock 或菜单栏图标重新打开。⌘Q、应用菜单或菜单栏图标的「退出工坊」才会结束后台。

## 个人数据

数据保存在 `~/Library/Application Support/NAI Atelier/workspace/local-data`，独立于 `.app`；删除应用不会删除个人数据。存储键与 Windows／源码版一致，迁移资料前请先完整备份，不要改动 `wrangler.toml` 中的数据库名称或 ID。

## 与 Windows 版的差异

- **应用更新**：没有发布者签名，Electron 自动更新器无法替换应用。「全局设置 → 数据与维护 → 应用更新」只检查 GitHub 发行版并打开下载页，需手动下载新 DMG 覆盖安装。
- **仅 Windows 提供的功能**：风格收集悬浮窗、画师样张图包管理、系统目录选择式的存储位置切换、桌面快捷方式与 Pixiv Edge 回调监听依赖 PowerShell／Windows API，在 macOS 版中按现有平台检查显示为不可用。生图、实验室、风格串、Agent、反推、备份、局域网手机访问等核心功能不受影响。
