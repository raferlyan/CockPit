# Cockpit

Android 设备投屏、终端与状态监控桌面工具（macOS / Windows）。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 开发

需要 Node 22+ 和 Android SDK platform-tools（adb）。

```bash
npm install
npm run dev
```

国内网络下 Electron 二进制下载慢时，用环境变量指定镜像（npm 11 起 `.npmrc` 里的 `ELECTRON_MIRROR` 不再生效）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式（热更新） |
| `npm run typecheck` | 类型检查 |
| `npm test` | 单元测试 |
| `npm run package` | 构建未打包的应用目录到 `release/` |
| `npm run dist:mac` / `npm run dist:win` | 生成安装包 |

## adb 查找顺序

用户设置 → `ANDROID_HOME` / `ANDROID_SDK_ROOT` → `PATH` → SDK 默认安装位置 → 应用内置。
