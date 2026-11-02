<p align="center">
  <img src="docs/assets/logo.svg" width="128" height="128" alt="Cockpit logo">
</p>

<h1 align="center">Cockpit</h1>

<p align="center">
  Android 设备调试桌面工具：投屏操控、adb 终端、串口终端、设备负载监控，一个窗口搞定。<br>
  支持 macOS 与 Windows。
</p>

<p align="center">
  <b>中文</b> | <a href="README.en.md">English</a> ·
  <a href="https://github.com/raferlyan/CockPit/releases/latest">下载</a>
</p>

## 功能

- **投屏与操控**：基于 [scrcpy](https://github.com/Genymobile/scrcpy) 5.0.1 服务端，画面用 WebCodecs 硬件解码后嵌在主窗口里。
  - 鼠标：左键触摸，右键返回，中键主页，滚轮滚动。
  - 键盘：可以直接打字，中文输入法也能用。
  - 剪贴板：电脑和设备双向同步，Cmd/Ctrl+C、Cmd/Ctrl+V。
  - 工具栏：返回、主页、多任务、音量、电源、通知栏、旋转。
  - 按需显示：默认中间区域显示设备状态，点「投屏」后投屏画面才换到中间。
  - 多设备：最多 4 台同时投屏，可在网格（并排显示）和单台之间切换。切换设备不会中断其它设备的投屏；多台时自动降低分辨率和码率。
- **adb 终端**：多标签，支持 Tab 补全、Ctrl+C、vi 等交互操作。标签上显示设备序列号和当前身份，`$` 是普通用户，`#` 是 root。
  - 智能提示：输入时弹出命令、子命令、选项、设备上的包名和历史命令候选，Tab / → 采用。
  - 复制粘贴：macOS 用 Cmd+C / Cmd+V，Windows 用 Ctrl+Shift+C / V，也可以右键菜单。
  - 把文件拖进终端会插入它的绝对路径。
- **文件传输**：拖入或选择本机文件，输入、点选或浏览设备目录后上传；也可以把设备上的文件下载到本机指定目录。
- **logcat**：带颜色，可以附加过滤参数，如 `-s ActivityManager` 或 `--pid=$(pidof -s 包名)`。
- **串口终端**：通过 USB 转串口线连接设备的调试串口，不依赖 adb。
  - 可设置波特率、数据位、校验、停止位、硬件流控，以及回车发送的换行符。
  - 支持本地回显，拔线后可以原地重连。
- **设备状态**：
  - 每秒刷新：CPU 总占用及每个核心的占用和频率、内存与 Swap、CPU/GPU/电池/机身温度、电池状态、网络速率。
  - 另外显示进程 Top 10 和存储占用。
  - 最近 5 分钟曲线；连接多台设备时可以叠加对比。
- **设备管理**：设备插拔自动识别，支持无线连接（`adb connect`），显示 root 可用状态。
- **出错有提示**：操作失败、超过 8 秒没有响应、按钮暂时不可用，都会弹出提示说明原因。

## 下载安装

到 [Releases](https://github.com/raferlyan/CockPit/releases/latest) 下载对应平台的安装包：

| 平台 | 文件 |
|---|---|
| macOS（Apple 芯片） | `Cockpit-<版本>-mac-arm64.dmg` |
| macOS（Intel） | `Cockpit-<版本>-mac-x64.dmg` |
| Windows 10 1809 及以上（x64） | `Cockpit-<版本>-win-x64.exe` |

安装包目前没有开发者签名，首次打开会被系统拦截：

- **macOS**：把 Cockpit 拖进「应用程序」后，在 Finder 里右键 Cockpit →「打开」→ 再点「打开」。如果提示“已损坏，无法打开”，在终端执行：

  ```bash
  xattr -cr /Applications/Cockpit.app
  ```

- **Windows**：SmartScreen 提示时点「更多信息」→「仍要运行」。

## 使用前准备

1. 电脑上安装 [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)（提供 adb）。Cockpit 会依次在以下位置查找 adb：
   - `ANDROID_HOME` / `ANDROID_SDK_ROOT`
   - `PATH`
   - SDK 默认安装位置
2. 手机打开「开发者选项 → USB 调试」，连接后在手机上允许调试授权。
3. 使用串口时，电脑需要装好 USB 转串口芯片（CH340、CP210x、FTDI 等）的驱动。

## 当前限制

- 视频编码只支持 H.264。
- root 认证（su 密码交互）、需要 root 权限的指标，以及应用私有存储浏览（SharedPreferences、MMKV、DataStore、SQLite）还在开发中。
- 音频转发尚未支持。

## 开发

需要 Node 22+ 和 adb。

```bash
npm install
npm run dev
```

国内网络下 Electron 二进制下载慢时，用环境变量指定镜像（npm 11 起 `.npmrc` 里的 `ELECTRON_MIRROR` 不再生效）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式（热更新） |
| `npm run typecheck` | 类型检查 |
| `npm test` | 单元测试 |
| `npm run fetch-server` | 下载并校验 scrcpy-server |
| `npm run package` | 构建未打包的应用目录到 `release/` |
| `npm run dist:mac` / `npm run dist:win` | 生成安装包 |

**应用图标**：源文件是 [docs/assets/logo.svg](docs/assets/logo.svg)。修改后执行 `npx electron scripts/render-icon.cjs`，重新生成打包用的 `build/icon.png`。

**发布新版本**：修改 `package.json` 里的版本号，然后推送 `v` 开头的标签（如 `git tag v0.2.0 && git push origin v0.2.0`）。GitHub Actions 会构建 macOS 与 Windows 安装包，并发布到 Releases。

完整的使用说明见 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)，架构与模块设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 技术栈

Electron · React · TypeScript · Zustand · xterm.js · node-pty · serialport · uPlot · WebCodecs · scrcpy-server

## 许可证

[Apache License 2.0](LICENSE)。scrcpy-server 来自 [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)，同样采用 Apache 2.0 许可证。
