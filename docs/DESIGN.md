# Cockpit 设计概要

> 状态：草案 v0.3 · 2026-10-31

## 1. 目标

Cockpit 是一个面向 Android 开发/测试的桌面端工具，支持 **macOS 与 Windows**，在一个窗口里集成：

1. **投屏与控制**：基于 scrcpy 协议，**2~3 台设备同时投屏**，支持鼠标/键盘/剪贴板反向控制，音频转发可选。
2. **终端**：内嵌 `adb shell` 交互终端，支持多标签、多设备。
3. **设备状态**：主动采集设备负载（CPU / 内存 / 温度 / 电池 / 进程）与存储使用情况；实时显示设备 root 状态。
4. **存储浏览**：浏览应用私有存储，支持 SharedPreferences、MMKV、DataStore、SQLite、普通文件。
5. **Root 认证**：可插拔的提权流程。v1 支持直接 su 和密码；挑战-应答（challenge-response）只预留接口，转换工具的接入后续再做。

### 非目标（v1 不做）

- iOS 设备
- 录屏转码、群控（多设备同步操作）
- 需要设备端常驻 App 的方案（只依赖 adb + 临时推送的 scrcpy-server）

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Electron + TypeScript** | macOS / Windows 一套代码；xterm.js / WebCodecs / 图表生态成熟 |
| UI | React + Vite，状态管理 Zustand | 轻量，适合多面板布局 |
| 投屏解码 | scrcpy-server（固定版本随包分发）+ 渲染进程 **WebCodecs** 硬解 | 画面嵌入主窗口；macOS 走 VideoToolbox，Windows 走 D3D11/MediaFoundation |
| 终端 | xterm.js + node-pty | Windows 使用 ConPTY，macOS 使用 forkpty |
| ADB 通信 | 调用 platform-tools 的 `adb` 二进制 | 复用用户已有 adb server，避免与 Android Studio 冲突 |
| 敏感信息存储 | Electron `safeStorage` | macOS Keychain / Windows DPAPI 加密，无需额外原生依赖 |
| 图表 | uPlot | 高频时序数据开销小 |
| 打包 | electron-builder | macOS dmg（签名+公证）、Windows NSIS（代码签名） |

## 3. 总体架构

```
┌──────────────────────── Renderer (React) ─────────────────────────┐
│ DeviceList │ MirrorGrid(N × WebCodecs) │ Terminal(xterm.js)       │
│ (root 徽标) │ StatusPanel(uPlot)        │ StorageBrowser           │
└───────────────────────────────┬───────────────────────────────────┘
                                │ IPC (contextBridge, typed channels)
┌───────────────────────────────┴──── Main Process (Node) ──────────┐
│ DeviceManager   — adb track-devices，设备上下线事件               │
│ DeviceSession × N（每台设备一个）                                 │
│   ├─ MirrorService   — scrcpy-server 启停、socket 转发             │
│   ├─ ShellService    — node-pty 终端会话池                         │
│   ├─ RootService     — 常驻 root 通道 + 认证流程 + 状态监测        │
│   ├─ MetricsService  — 定时采集、解析、环形缓冲                    │
│   └─ StorageService  — 文件列举、拉取、SP/MMKV/DataStore/DB 解析   │
│ RootAuthRegistry — 认证方式插件（v1：直接 su / 密码）              │
│ SecretStore      — safeStorage 加密保存密码等                      │
│ AdbClient        — 统一封装 adb 调用、超时、并发限流               │
└───────────────────────────────┬───────────────────────────────────┘
                                │ adb (USB / TCP)
                           ┌────┴────┐
                           │ Android │ scrcpy-server (app_process)
                           └─────────┘
```

原则：

- **所有 adb 交互只在主进程**，渲染进程只拿结构化数据。
- 每台设备一个 `DeviceSession`，设备断开时统一释放其下所有资源。
- `AdbClient` 是唯一出口，按设备做并发限流，投屏会话优先。
- **需要 root 的操作（采集受限节点、读写应用私有目录）统一走 RootService 的常驻 root 通道**，避免每次都重新认证。

## 4. 模块设计

### 4.1 设备管理（DeviceManager）

- 启动时 `adb start-server`，长连接 `adb track-devices` 监听变化。
- adb 路径查找顺序：用户设置 → `ANDROID_HOME`/`ANDROID_SDK_ROOT` → `PATH`（Windows 查 `adb.exe`）→ 应用内置的 platform-tools（可选）。
- 设备信息：serial、型号、Android 版本、ABI、分辨率、是否无线连接、**root 状态**。
- 支持 `adb pair` / `adb connect` 无线连接入口。

### 4.2 投屏（MirrorService）

单设备流程：

1. `adb push scrcpy-server /data/local/tmp/`
2. 生成随机 `scid`，`adb forward tcp:<空闲端口> localabstract:scrcpy_<scid>`
3. `adb shell CLASSPATH=... app_process / com.genymobile.scrcpy.Server <ver> scid=<scid> ...`
4. 建立 video / audio（可选）/ control 三条 socket。
5. 主进程解析视频流（v5 协议：4 字节编码 ID，之后是会话包〔宽高，旋转时重发〕与媒体包〔PTS+标志位+长度〕），经 `MessagePort` 直接转给渲染进程的解码 Worker。
6. 渲染进程在 **Worker** 中用 `VideoDecoder` 解码，绘制到 `OffscreenCanvas`。
7. 鼠标/键盘/滚轮/剪贴板事件按 scrcpy control 协议序列化后回写 control socket。

**多设备投屏**

- 每台设备独立的 `scid`、端口、socket、解码 Worker，互不影响。
- 布局：网格视图（自动排列）/ 标签视图 / 单台弹出为独立窗口。
- 焦点设备接收键盘输入；鼠标事件按所在画布路由到对应设备。
- 性能策略（按 2~3 台同时投屏设计）：
  - 默认每台 `max-size=1280`、码率 6Mbps；3 台同屏时可在设置中降到 1024px / 4Mbps。单台放大或弹出独立窗口时恢复原画质。
  - 最小化或被遮挡的画面停止解码；重新可见时请求关键帧（scrcpy 新版本支持 reset video 控制消息，旧版本则重启该路视频）。
- scrcpy-server 版本与协议实现**严格绑定**（当前 v5.0.1），由 `npm run fetch-server` 下载并校验 SHA-256 到 `resources/`；升级时同步修改脚本与 `SCRCPY_VERSION`。
- 快捷操作栏：Home / Back / 多任务 / 音量 / 电源 / 截图 / 旋转。

**音频转发**（可选，默认关闭）

把设备正在播放的声音实时传到电脑扬声器播放。scrcpy 2.0+ 支持，要求 Android 11+。

- 每台设备的投屏工具栏上有音频开关；全局设置提供“仅焦点设备出声”模式，避免多台混音。
- 未开启时启动 scrcpy-server 带 `audio=false`，不建立音频 socket，不占带宽。
- 设备低于 Android 11 时开关置灰并提示原因。
- 解码：Opus 用 WebCodecs `AudioDecoder`，经 `AudioWorklet` 播放，按 PTS 与画面做简单同步。

### 4.3 终端（ShellService）

- 每个标签一个 node-pty 进程：`adb -s <serial> shell`。
- 标签类型：普通 shell / root shell（复用 RootService 的认证流程自动完成提权）/ logcat（带过滤与高亮）。
- 处理 resize、命令历史、常用命令片段。
- 每个标签显示当前身份（`$` / `#`），通过提示符与 `id -u` 探测，用户在标签内手动 `su` 时同样能更新。
- 串口标签（SerialService，`serialport` 库）：连接 USB 转串口线上的设备调试串口，不依赖 adb；可配波特率、数据位、校验、停止位、RTS/CTS、回车发送 CR/LF/CRLF、本地回显。macOS 上自动使用 `/dev/cu.*`。拔线时标签标记为已结束，可原地重连。

### 4.4 Root 认证与状态（RootService）

#### 4.4.1 root 的几种形态

| 形态 | 判定方式 | 说明 |
|---|---|---|
| adbd root | `adb shell id -u` 返回 0 | userdebug/eng 镜像执行过 `adb root` |
| su 可用 | 存在 `su`，且能拿到 uid 0 | Magisk / KernelSU / 厂商 su |
| 无 root | 以上都不满足 | 降级为 run-as / 公共存储 |

#### 4.4.2 常驻 root 通道

- 每台设备维持一个长连接 `adb shell`，在其中执行一次 `su`（经过认证流程）后保持不退出。
- 后续 root 命令通过该通道串行执行，用唯一标记包裹输出以切分结果：
  `echo __BEGIN_<id>__; <cmd>; echo __END_<id>__ $?`
- 通道断开（设备重启、su 被撤销、超时）时自动标记状态并按策略重连；需要人工输入的认证方式则提示用户。

#### 4.4.3 可插拔认证方式

su 之后的交互由 `RootAuthProvider` 驱动，本质是一个基于 PTY 输出的 expect 状态机：

```ts
interface RootAuthProvider {
  id: string;
  name: string;
  // 根据 su 后的输出判断下一步：发送什么、是否需要用户介入、是否成功
  handle(output: string, ctx: AuthContext): Promise<AuthStep>;
}

type AuthStep =
  | { type: 'send'; text: string }          // 往 PTY 写入（如密码、应答串）
  | { type: 'wait' }                         // 继续等待输出
  | { type: 'success' }
  | { type: 'fail'; reason: string };
```

v1 内置两种：

1. **直接 su**：`su` 后无提示即成功（Magisk / KernelSU 已授权）。
2. **密码**：匹配到密码提示（可配置正则）后填入密码；密码由 `SecretStore` 加密保存，可选择“每次询问”或“记住”。

认证配置可按**设备型号/serial 规则**绑定。认证过程超时（默认 15s）或出现无法识别的输出时，状态置为失败，并提示用户打开 root 终端手动完成。

**后续扩展：挑战-应答**（v1 不实现，只保证接口能承载）

- 从 su 输出中用正则提取挑战串，交给转换器得到应答串，再写回 PTY。
- 转换器的接入方式（外部程序 / 脚本插件 / 手动粘贴）待拿到实际样例后再定。
- `RootAuthProvider` 的 `handle` 已支持异步与用户介入（`root:prompt`），新增方式只需注册一个 Provider，不改 RootService。

#### 4.4.4 状态实时显示

- 设备列表、投屏窗口标题栏、状态面板上显示 root 徽标：
  - 🟢 已 root（adbd root / su 通道已建立）
  - 🟡 可 root 未认证（检测到 su，但未完成认证）
  - ⚪ 无 root
  - 🔴 认证失败 / 通道断开
- 监测手段：root 通道每 5s 心跳 `id -u`；PTY 退出、心跳超时、设备重连都会立即触发状态更新。
- 一键操作：认证 / 断开 root 通道 / 查看认证日志（日志中对密码和应答串打码）。

### 4.5 设备状态（MetricsService）

主动轮询，默认 1s（负载类）/ 10s（存储类），可配置。多条读取合并成**一次 shell 调用**，用分隔符切分输出。有 root 通道时走 root 通道，可读取更多受 SELinux 限制的节点。

| 指标 | 数据来源 | 说明 |
|---|---|---|
| CPU 总体/每核占用 | `/proc/stat` 两次采样差值 | 无需 root |
| CPU 频率 | `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq` | 部分机型需 root |
| 内存 | `/proc/meminfo` | MemAvailable、Swap/ZRAM |
| 进程 Top N | `top -b -n 1 -o PID,USER,%CPU,RES,NAME` | 低频（3~5s） |
| 单应用内存 | `dumpsys meminfo <pkg>` | 按需，开销大 |
| 温度 | `/sys/class/thermal/thermal_zone*/temp` + `type` | 厂商命名差异大，做映射表 |
| 电池 | `dumpsys battery` | 电量、温度、电压、充电状态 |
| GPU | `/sys/class/kgsl/...`（高通）、`/sys/kernel/gpu/...` | 尽力而为，取不到则隐藏 |
| 网络流量 | `/proc/net/dev` | 差值计算速率 |
| 存储 | `df /data /sdcard`，`dumpsys diskstats` | 分区占用、应用占用 |

- 每台设备独立的环形缓冲（默认保留 10 分钟），支持导出 CSV。
- 阈值告警（如温度 > 45℃、可用内存 < 10%）。
- 多设备时提供对比视图：同一指标多设备曲线叠加。

### 4.6 存储浏览（StorageService）

访问方式按优先级自动选择：root 通道 → `run-as <pkg>`（debuggable 应用）→ 公共存储 `adb pull/push` → 提示不可访问。

所有写操作遵循同一流程：**本地备份 → `am force-stop <pkg>` → 写入 → 恢复属主/权限/SELinux 上下文（`chown` / `chmod` / `restorecon`）→ 回读校验**。支持一键还原到备份。

#### SharedPreferences

- 路径：`/data/data/<pkg>/shared_prefs/*.xml`
- 解析 XML 为键值表（string / int / long / float / boolean / set），支持搜索、编辑、增删键。
- 写回必须先 force-stop，否则应用进程会用内存中的值覆盖文件。

#### MMKV

- 路径：默认 `/data/data/<pkg>/files/mmkv/`，每个实例为数据文件 + `.crc` 文件。
- 格式：头部 4 字节有效长度 + protobuf 风格的 varint 编码键值序列（同一个键可能出现多次，取最后一次）。
- 难点：
  - **值不带类型信息**，只有字节。UI 提供多种解读（字符串 / int32 / int64 / float / double / bool / 十六进制），按启发式给出默认值，并记住用户为每个键选择的类型。
  - **加密实例**（AES-128-CFB，IV 存在 `.crc` 文件中）：先按明文尝试解析，失败则标记为“疑似加密”，用户可输入 cryptKey 解密，key 按“包名 + 实例名”保存在 SecretStore。拿不到 key 的实例只显示文件信息，不报错。
  - 多进程模式下有文件锁，读取时建议先 force-stop。
- 写回：重新序列化整个文件，更新长度头和 `.crc`（CRC32 + 序列号）。v1 先只读，v1.1 开放编辑。

#### DataStore

- **Preferences DataStore**：路径 `/data/data/<pkg>/files/datastore/*.preferences_pb`，schema 固定（`PreferenceMap`），可完整解码与编辑，体验同 SP。
- **Proto DataStore**：schema 由应用定义。支持两种方式：
  - 用户导入 `.proto` 文件后结构化解码（使用 protobufjs）。
  - 无 schema 时按原始 protobuf 解码显示字段号/wire type/值，只读。

#### SQLite

- 拉取 `databases/*.db`（连同 `-wal`/`-shm`）到本地临时目录，用 better-sqlite3 浏览表结构与数据。
- v1 只读；后续支持执行 SQL 并写回（同样走 force-stop + 备份流程）。

#### 普通文件

- 树形浏览、文本/图片预览、上传下载、拖拽传输。

## 5. 跨平台注意事项

| 问题 | 处理 |
|---|---|
| adb 可执行文件 | Windows 为 `adb.exe`，路径含空格时正确转义 |
| PTY | node-pty 在 Windows 依赖 ConPTY（Win10 1809+），作为最低系统要求 |
| 换行符 | adb shell 输出统一按 `\r?\n` 切分 |
| 原生模块 | node-pty、better-sqlite3 需为两个平台分别编译，CI 用 macOS + Windows runner 构建 |
| 视频解码 | 启动时用 `VideoDecoder.isConfigSupported` 探测，H.265 不支持时回退 H.264 |
| 签名 | macOS 需要签名 + 公证；Windows 需要代码签名证书，否则 SmartScreen 拦截 |

## 6. IPC 约定

- 渲染进程统一经 `api.ts` 调用主进程：需要等待结果的请求超过 8s 未返回时弹“无响应”提示，返回后改写为完成或失败。
- 兜底提示：未处理的 Promise 失败、脚本异常、主进程未捕获异常（`app:error`）都弹提示；各面板有独立的错误边界，崩溃只影响该面板；不可用的按钮点击时说明原因。

- 请求-响应：`ipcRenderer.invoke('<module>:<action>', payload)`，如 `storage:readPrefs`、`root:authenticate`。
- 推送流：设备事件、指标、root 状态、终端输出走 `webContents.send('<module>:event', …)`；视频帧走 `MessagePort`。
- 认证过程需要用户介入时（输入密码、手动应答），主进程发 `root:prompt` 事件，渲染进程弹窗后回传结果。
- 所有通道的类型定义集中在 `src/shared/ipc.ts`，主/渲染两端共用。
- 密码、密钥、应答串**不进入渲染进程日志**，IPC 层统一打码。

## 7. 目录结构（规划）

```
Cockpit/
├─ docs/
├─ resources/            # scrcpy-server、图标
├─ src/
│  ├─ main/
│  │  ├─ adb/
│  │  ├─ mirror/
│  │  ├─ shell/
│  │  ├─ root/           # RootService、认证插件、常驻通道
│  │  ├─ metrics/
│  │  ├─ storage/
│  │  │  └─ formats/     # sp、mmkv、datastore、sqlite 解析器
│  │  └─ secrets/
│  ├─ preload/
│  ├─ renderer/
│  └─ shared/
└─ package.json
```

## 8. 界面布局

```
┌──────────┬────────────────────────────────┬──────────────────────┐
│ 设备列表  │  投屏区（网格 / 标签）            │ 状态面板              │
│ 🟢 Pixel │  ┌────────┐ ┌────────┐          │ (焦点设备的曲线，      │
│ 🟡 Mi 14 │  │ Pixel  │ │ Mi 14  │          │  可切换多设备对比)     │
│ ⚪ OPPO  │  └────────┘ └────────┘          ├──────────────────────┤
│          │  ┌────────┐                     │ 存储浏览              │
│          │  │ OPPO   │                     │ SP / MMKV / DataStore│
│          ├──┴────────┴─────────────────────┴──────────────────────┤
│          │ 终端（多标签：Pixel·shell / Mi 14·root / logcat）        │
└──────────┴────────────────────────────────────────────────────────┘
```

面板可拖拽、折叠；单台投屏可弹出为独立窗口。状态面板和存储浏览跟随“焦点设备”切换。

## 9. 里程碑

| 阶段 | 内容 |
|---|---|
| M0 | 工程脚手架（mac + win CI 构建）、AdbClient、设备列表 |
| M1 | 单设备投屏 + 控制 |
| M2 | 多设备投屏、网格布局、性能策略 |
| M3 | 内嵌终端（多标签、logcat） |
| M4 | RootService：常驻通道、直接 su / 密码认证、状态徽标 |
| M5 | 负载采集与曲线、多设备对比 |
| M6 | 存储浏览 + SP / Preferences DataStore 编辑 |
| M7 | MMKV（只读→编辑）、Proto DataStore、SQLite |
| M8 | 告警、导出、音频转发、打包签名发布 |
| 后续 | 挑战-应答认证接入 |

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| scrcpy 协议随版本变化 | 固定 server 版本；协议层单独模块并配测试 |
| 多设备投屏占用 CPU/GPU 与 USB 带宽 | 网格模式降分辨率/码率、隐藏画面暂停解码、硬解优先 |
| 各厂商 su 交互差异大 | 认证流程插件化 + 正则可配置 + 交互录制辅助配置 |
| 密码/密钥泄露 | safeStorage 加密存储；日志与 IPC 打码；插件运行在隔离进程 |
| 采集命令加重设备负载 | 合并命令、限流、可调频率；投屏优先 |
| sysfs 路径差异、SELinux 拦截 | 能力探测，取不到的指标隐藏 |
| SP/MMKV 写回被应用覆盖或损坏 | force-stop、备份、回读校验、一键还原 |
| MMKV 值无类型 | 多种解读 + 记住用户选择 |

## 11. 已确认决策

| 问题 | 结论 |
|---|---|
| 目标平台 | macOS + Windows |
| 设备 root | 有 root；需要密码/挑战等认证交互，root 状态实时显示 |
| 同时投屏数量 | 2~3 台 |
| 音频转发 | 做成可选，默认关闭 |
| 存储介质 | SP、MMKV、DataStore、SQLite 都要支持 |
| 挑战-应答转换工具 | 暂不处理，只预留接口 |
| MMKV 加密 | 情况不明，先支持明文；有 cryptKey 时可解密 |
