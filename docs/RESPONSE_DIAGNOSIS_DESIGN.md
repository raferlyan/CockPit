# Cockpit 响应诊断（APM）改造设计

> 状态：草案 v0.2 · 2026-11-10 · 基于 v0.8.0
>
> v0.2：新增第 3 章“实时监控增强”（阶段 M），排在响应诊断之前。
> 进度：M1–M3 已实现（未发版），响应诊断 P0 起待做。M3 与设计的差异：30 分钟（1800 点）uPlot 绘制无压力，未做降采样；录制文件放在 文稿/Cockpit/Metrics（与 Traces 并列）。手动打标记的快捷键实际为 ⌘⇧M / Ctrl+Shift+M（⌘M 是 macOS 的最小化窗口）。

## 1. 要回答的问题

> “我点了屏幕上一个按钮，过了很久才有反应。到底是负载高导致的卡顿、接口返回慢，还是别的原因？”

把这个问题拆开，一次点击从手指按下到用户看到结果，经过下面这条链路。**“慢”一定落在其中某一段或某几段上**，诊断要做的就是测出每段的耗时，再给出主因：

```
 ① 输入分发        ② 主线程处理                ③ 等待异步结果          ④ 出帧           ⑤ 合成上屏
 tap ─► InputDispatcher ─► App 主线程 onClick ─► (网络 / 数据库 / binder) ─► doFrame / RenderThread ─► SurfaceFlinger ─► 屏幕
        │                   │                    │                        │                  │
        系统繁忙、ANR 前兆    CPU 抢占、自身耗时、   接口慢、IO 慢、          过度绘制、GPU 慢、   合成掉帧
                            锁、GC、同步 binder     锁等待                  主线程又被阻塞
```

衡量“响应”要分清两个时间点，很多“慢”其实是第二个慢：

| 里程碑 | 定义 | 典型含义 |
|---|---|---|
| **首次反馈 (T1)** | 点击后画面第一次出现变化（按压态、loading、跳转动画） | 超过 100 ms 用户就会觉得“没点上” |
| **内容就绪 (T2)** | 画面重新稳定，结果内容已经显示出来 | 一般受接口和数据加载影响 |

结论示例（产品要输出的就是这种东西）：

> 首次反馈 **86 ms**（正常）· 内容就绪 **2.41 s**（慢）
> **主因：网络等待 1.93 s（占 80%）**：主线程在 T+40 ms 进入空闲，`OkHttp api.example.com` 线程从 T+52 ms 发出请求，T+1.98 s 才收到响应，随后 1 帧内完成刷新。
> 次因：响应到达后主线程执行 `RecyclerView` 布局 310 ms，其中 Runnable（等 CPU）120 ms，当时 CPU 大核 4 个均 > 90%，`com.xx.sync` 占 38%。

## 2. 现有能力盘点

Cockpit 已经具备的能力足够支撑大部分诊断，关键是把它们**围绕“一次点击”串起来**：

| 现有能力 | 位置 | 在诊断里的用途 |
|---|---|---|
| scrcpy 控制通道（注入 touch） | `mirror/MirrorSession`、`shared/mirror.ts` `ControlInput` | **准确知道点击发生的时刻**；可以自动重放同一次点击 N 次做统计 |
| scrcpy 视频流 + Worker 解码 | `mirror/decoder.worker.ts` | 逐帧比对，检测 T1（首次变化）和 T2（画面稳定） |
| 录屏 | `mirror/ScreenRecorder.ts` | 给每次诊断附一段带时间标尺的视频片段 |
| Perfetto 录制 | `trace/TraceRecorder.ts`、`traceConfig.ts` | 时间分解的数据来源（调度、atrace、binder、帧时间线） |
| 内嵌 Perfetto UI | `trace/PerfettoUiServer.ts`、`TraceWindow` | 一键跳到点击那一段做深入分析 |
| 状态采集 | `metrics/MetricsService.ts` | 点击前后的 CPU/频率/温度/内存/GPU/网速作为背景 |
| 进程 Top N | `metrics/parsers.ts` `parseTop` | 找出“抢 CPU 的是谁” |
| root 常驻会话 | `root/RootSession` | 读受限节点、抓包、改 traced 配置 |
| logcat | 终端 logcat 标签 | 截取点击前后几秒的日志（异常、StrictMode、慢 SQL） |
| 操作日志 | `oplog/` | 记录诊断里执行过的命令，保证可追溯 |

**缺少的部分**：点击打标、画面变化检测、长期运行的环形 trace（事后回溯）、trace 自动分析（SQL）、网络请求可见性、归因规则引擎、诊断报告 UI。

## 3. 前置：实时监控增强（阶段 M）

响应诊断回答“这一次为什么慢”，前提是先能**一边操作一边看清设备和应用的状态**。按 v0.8.0 的状态面板评估，整体负载已经比较直观（自动采集、数字卡片、曲线、每核、Top 进程、多设备对比），但看“性能”还有六个缺口：

| # | 缺口 | 现状（代码依据） |
|---|---|---|
| G1 | 没有流畅度指标 | 投屏角标的 fps 是视频流的解码帧率（`decoder.worker.ts` 的 `stats`），不是应用的渲染帧率 |
| G2 | 没有单应用视角 | 只有全系统 `top` 前 10，3 s 刷新（`PROCESSES_COMMAND`）；不能排序、搜索、固定，不标前台应用 |
| G3 | 只有当下，没有过去 | 主进程和渲染进程都只保留 300 条（5 分钟）；曲线不能暂停、缩放；CSV 导出和阈值告警（DESIGN.md §4.5）未实现 |
| G4 | 投屏时负载被挤到侧栏 | `App.tsx` 中投屏时 `StatusPanel` 只能在右侧窄栏，边操作边看要来回滚动 |
| G5 | 曲线和操作对不上 | 曲线上没有任何事件标记 |
| G6 | 缺少解释“为什么卡”的指标 | iowait 被算进空闲（`parseProcStat`）；没有 PSI、温控限频状态；每核只有瞬时值，不区分大小核 |

本阶段补齐这些缺口，产出的前台应用识别、帧数据、事件标记、长历史，后面的响应诊断都会直接复用。

### 3.1 投屏画面叠加负载条（HUD）— 解决 G4

- 在 `MirrorView` 画面上方（或下方，可拖动）叠加一条半透明的负载条，每台投屏各一条，工具栏上可以开关，默认开启：

  ```
  ┌──────────────────────────────────────────────────────────────┐
  │ CPU 63% ▂▃▅▇  内存 71%  CPU 42.5℃  ⚠ 大核限频  │ com.example.shop  58 fps · 掉帧 4% │
  └──────────────────────────────────────────────────────────────┘
  ```

- 数值超过阈值时变色（与 §3.6 告警共用同一套阈值）；悬停显示最近 60 s 迷你曲线，点击打开完整状态面板。
- 状态面板增加一个“**弹出为独立窗口**”按钮（新 `BrowserWindow`，复用 `StatusPanel wide`），适合双屏：一块屏投屏操作，另一块屏看完整曲线。
- 数据直接读 `metricsStore`，不新增采集。

### 3.2 前台应用与流畅度（FPS / 掉帧）— 解决 G1

**前台应用识别**：每 2 s 执行一次 `dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity'`（在设备端过滤，只回传一两行），得到包名、Activity 和 pid。前台切换时产生事件（§3.5）。

**帧数据**按应用类型分两路，自动选择：

| 来源 | 命令 | 覆盖范围 | 说明 |
|---|---|---|---|
| HWUI 帧统计（主路） | `dumpsys gfxinfo <pkg> framestats`，每 1 s | View、Compose 等走 HWUI 渲染的界面 | 每次返回最近约 120 帧的各阶段时间戳；按 `IntendedVsync` 去重后累积 |
| SurfaceFlinger 图层统计（兜底） | `dumpsys SurfaceFlinger --timestats -enable` 后定期 `-dump` | SurfaceView、游戏、Flutter、视频 | 按图层统计上屏间隔；部分 ROM 需要 root |

由帧数据计算并推送（新事件 `frames`）：

- **FPS**：最近 1 s 实际完成的帧数。**只在有新帧时计算**，静止画面显示“静止”而不是 0 fps，避免误判为卡死。
- **掉帧率**：帧耗时（`FrameCompleted − IntendedVsync`）超过一个刷新周期的帧占比；刷新周期在开始时从 `dumpsys display` 读一次，支持 90/120 Hz。
- **大卡顿**：单帧 > 100 ms 记为一次，同时打一个事件标记（§3.5）。
- **帧耗时分布**：P50 / P90 / P99，以及最近 120 帧的柱状图（超过刷新周期的柱子标红）。

成本控制：`gfxinfo` 是一次对目标进程的 binder 调用，只在 HUD 或状态面板可见、且前台是普通应用（不是桌面）时采集。

### 3.3 关注应用 — 解决 G2

- 可以在三处“关注”一个应用：HUD 上的前台应用、进程表的右键菜单、应用管理对话框。默认自动关注当前前台应用，用户固定后不再跟随切换。
- 采集**合并进每秒那一次负载命令**，不增加 shell 调用：已知 pid 时在 `loadCommand` 末尾追加 `cat /proc/<pid>/stat /proc/<pid>/status`。多进程应用（`:push`、`:remote` 等）按 `cmdline` 前缀聚合全部 pid。
  - CPU%：`utime + stime` 的差值，与 `/proc/stat` 同一时刻采样，口径一致。
  - 内存：`VmRSS`、线程数（`Threads`）每秒；PSS 用 `dumpsys meminfo <pkg>` 每 10 s 采一次（开销大，只在关注时）。
  - 线程 Top：`top -H -p <pid>` 每 3 s，看主线程、RenderThread 和哪个工作线程在占 CPU。
- pid 变化即视为进程重启：pid 消失时检查 crash 缓冲（§3.5）区分“崩溃”和“被系统杀死”。
- 状态面板新增“应用”区块：CPU / 内存 / 线程数 / FPS 四条曲线，与系统曲线共用时间轴。
- 全系统进程表改为可按 CPU、内存、名称排序，支持搜索和固定行，条数可调（10 / 30 / 全部），前台应用高亮。

### 3.4 时间轴：暂停、缩放、长历史、导出 — 解决 G3

- **曲线交互**：所有曲线共用一个 uPlot `cursor.sync` 分组，悬停时竖线和数值联动；拖选区间放大，双击恢复；右上角“暂停”冻结画面（采集照常进行），恢复后跳回最新。
- **历史长度**：内存中的环形缓冲从 300 条延长到 1800 条（30 分钟，每条约 1 KB，3 台设备合计约 5 MB）。渲染进程按可见时间窗口降采样后再交给 uPlot（≥ 10 分钟时按每 5 s 取 min/max），保证流畅。
- **会话录制**：状态面板上的“录制”按钮把采集数据按 NDJSON 追加写到 `userData/metrics/<serial>/<时间>.ndjson`（含 §3.5 的事件），不限时长；之后可以在面板里打开历史会话，像实时数据一样浏览。不点录制就不落盘。
- **导出**：当前视图或拖选的区间导出 CSV（每秒一行，展开 CPU 每核、频率、温度、应用指标等列）或 JSON（含事件），文件名带设备型号和时间。

### 3.5 事件标记 — 解决 G5

新增共享类型 `MetricsMarker { t, serial, kind, label, detail? }`，由主进程汇总后随 `MetricsEvent` 推送，在所有曲线上画成竖线，悬停显示说明，点击跳到对应详情：

| 来源 | 事件 | 实现 |
|---|---|---|
| 投屏控制 | 点击、滑动、按键（合并 300 ms 内的连续输入） | `MirrorSession` 发送控制消息时上报 |
| 前台识别（§3.2） | 应用切换、Activity 切换 | 2 s 轮询比较前后两次结果 |
| 关注应用（§3.3） | 进程启动、退出、崩溃 | pid 变化 + crash 缓冲 |
| logcat | 崩溃、ANR、低内存查杀 | 每台设备常驻一个 `logcat -b crash,events -T 1` 进程，只匹配 `am_anr`、`am_crash`、`am_kill`、`lowmemorykiller` 等少数标签 |
| 帧数据（§3.2） | 大卡顿（单帧 > 100 ms） | 帧统计计算时产生 |
| 操作日志 | 安装应用、开始/结束录制 trace、进入 root 等 | 订阅 `OperationLog` |
| 告警（§3.6） | 阈值触发与恢复 | 规则引擎产生 |
| 手动 | 用户打点并写备注 | 快捷键 `⌘⇧M` / `Ctrl+Shift+M` |

### 3.6 解释性指标与告警 — 解决 G6

新增指标，尽量合并进现有命令：

| 指标 | 来源 | 展示 |
|---|---|---|
| IO 等待 | `/proc/stat` 的 iowait 单独计算（目前算作空闲） | CPU 曲线上叠一层，CPU 卡片副标题显示 |
| 压力（PSI） | `/proc/pressure/{cpu,memory,io}` 的 `avg10`（内核 4.19+，Android 10 起多数设备有；读不到则隐藏） | 一张“资源压力”曲线，比占用率更能反映“有任务在排队” |
| 簇与限频 | 启动时读 `cpufreq/related_cpus`、`cpuinfo_max_freq` 划分小 / 中 / 大核；每秒比较 `scaling_max_freq` 与 `cpuinfo_max_freq` | 每核按簇分组；被压低时显示“大核限频 1.8 / 3.2 GHz” |
| 温控等级 | `dumpsys thermalservice` 的 Thermal Status（0–6），跟电池一起每 5 s | 温度卡片上显示“轻度 / 中度 / 严重…” |
| 每核历史 | 已有数据 | “各核心”区块增加一张核 × 时间的热力图 |

**告警规则**（设置里可调，默认值如下）。持续满足 N 秒才触发，触发后冷却 60 s，避免刷屏；触发时打事件标记，HUD 变色，通过现有 `notifyStore` 弹出提示，并记入告警历史：

| 规则 | 默认阈值 |
|---|---|
| CPU 温度过高 | > 45 ℃ 持续 10 s |
| 温控等级 | ≥ 中等（2，系统开始主动降频） |
| 可用内存不足 | < 10% 持续 10 s，或发生低内存查杀 |
| 大核限频 | 最高频率被限到 < 70% 持续 10 s |
| 前台应用掉帧 | 掉帧率 > 20% 持续 5 s，或出现单帧 > 300 ms |
| 关注应用异常 | 崩溃、ANR、被杀 |

### 3.7 采集预算

改造后每台设备的 shell 调用（不投屏、无 root 时）：

| 任务 | 现在 | 改造后 |
|---|---|---|
| 负载（含关注应用 `/proc/<pid>`、PSI、限频节点） | 1 次 / 1 s | 1 次 / 1 s（同一条命令变长） |
| GPU / NPU | 1 次 / 2 s | 不变 |
| 前台应用 | — | 1 次 / 2 s |
| 帧统计 | — | 1 次 / 1 s（仅可见且前台是普通应用时） |
| 进程 / 线程 Top | 1 次 / 3 s | 1 次 / 3 s（关注应用时多一次 `top -H`） |
| 电池 + 温控等级 | 每 5 次负载带一次 | 不变（多拼一条命令） |
| 存储 | 1 次 / 10 s | 不变 |
| logcat 事件 | — | 1 个常驻进程 |

新增的轮询都遵守现有的规则：上一轮没返回就跳过本轮。录制 trace 和响应诊断布防时，沿用 `pauseMetrics` 的思路进入低打扰模式，只保留负载一项。

### 3.8 数据模型改动

- `LoadSample`：`cpu` 增加 `iowait`；新增 `psi?: { cpu, memory, io }`、`throttle?: { cluster, curMaxMHz, maxMHz }[]`、`thermalStatus?: number`。
- 新增 `AppSample`（关注应用每秒一条：`pid[]`、`cpu`、`rssKB`、`pssKB?`、`threads`）和 `FrameStats`（`fps`、`jankRatio`、`p50/p90/p99`、`bigJanks`、`frames?: number[]`）。
- `MetricsEvent` 增加 `app`、`frames`、`foreground`、`marker`、`alert` 五种。
- 新增文件：`src/main/metrics/ForegroundTracker.ts`、`FrameStatsCollector.ts`、`AppProbe.ts`、`MarkerHub.ts`、`AlertRules.ts`（纯函数，配单测），`src/renderer/src/metrics/MirrorHud.tsx`、`AppSection.tsx`、`Timeline.ts`（曲线同步、降采样、事件标记绘制）。

## 4. 总体方案

新增一个“**响应诊断**”模式。核心循环：

```
  [布防] 后台启动环形 Perfetto（只保留最近 N 秒）+ 加密采集频率
     │
  [触发] ① 在投屏画面上点击（Cockpit 打标，最准）
     │   ② 直接在手机上点（从 trace 的 input 事件里识别）
     │   ③ 点完觉得卡，按“抓刚才”快捷键（回溯）
     ▼
  [收尾] 点击后再录 3 s（或画面稳定后 1 s）→ 停止 / 克隆 trace → 拉回本机
     │
  [分析] trace_processor 跑 SQL → 时间分解 → 归因规则 → 结论
     │
  [呈现] 诊断卡片：瀑布图 + 主因 + 证据 + 视频片段 + “在 Perfetto 中打开”（已缩放到这次点击）
     │
  [重复] 可选：自动重放同一点击 N 次，给出 P50/P90 和波动原因
```

### 4.1 架构

```
┌──────────────────────── Renderer ────────────────────────────────┐
│ MirrorGrid ──(点击打标)──► DiagnosisStore ◄── DiagnosisPanel      │
│ decoder.worker ──(帧差分: T1/T2 候选帧)──┘      (瀑布图 / 结论 / 历史) │
└──────────────────────────────┬────────────────────────────────────┘
                               │ IPC: diag:arm / diag:mark / diag:capture / diag:event
┌──────────────────────────────┴── Main ────────────────────────────┐
│ DiagnosisService（新增，每台设备一个会话）                        │
│   ├─ RingTraceSession   — 复用 TraceRecorder，新增 response 预设    │
│   ├─ ClockSync          — 主机时间 ↔ 设备 BOOTTIME ↔ 视频 PTS 对齐   │
│   ├─ NetProbe           — 网络可见性（分级，见 §5.5）               │
│   ├─ TraceAnalyzer      — 调用 trace_processor_shell 跑 SQL         │
│   ├─ Attribution        — 归因规则引擎，纯函数，便于单测             │
│   └─ ReportStore        — 诊断记录持久化（json + trace + mp4 片段）  │
│ 复用：MetricsService（背景指标）、logcat、OperationLog、RootSession │
└───────────────────────────────────────────────────────────────────┘
```

新增共享类型放 `src/shared/diagnosis.ts`，服务放 `src/main/diagnosis/`，界面放 `src/renderer/src/diagnosis/`，和现有模块的组织方式一致。

## 5. 关键模块设计

### 5.1 点击打标与时间对齐（ClockSync）

诊断的所有结论都基于**设备时钟**，这样投屏本身的编码、传输、解码延迟就不会混进结果。

- **点击时刻**：以 trace 中 `InputDispatcher` 对该 MotionEvent 的分发事件为准（atrace `input` 类，可以拿到 `deliverInputEvent` / `aq:pending:*` / `iq` 计数）。Cockpit 注入时在主机侧记下 `hostTapAt`、坐标、目标 Activity，用来在 trace 里**匹配是哪一次** DOWN/UP（按时间窗 + 序号匹配）。
- **主机 ↔ 设备偏移**：布防时执行几次 `cat /proc/uptime` 并记录往返时间，取 RTT 最小的一次估算偏移（类似 NTP），误差通常 < 5 ms。`TraceRecorder` 里已经在用 `/proc/uptime` 计算 `TraceWindow`，这里抽成公共工具。
- **视频 PTS ↔ 设备时间**：scrcpy 的 PTS 来自 MediaCodec，基于 `System.nanoTime()`（CLOCK_MONOTONIC）。⚠️ 需要验证 v5.0.1 的 server 是否减去了起始值（`ptsOrigin`）。如果减了：用“注入一次点击 → SurfaceFlinger 上屏 → 对应帧到达”做一次标定；没减：只需再算 MONOTONIC 与 BOOTTIME 的差（设备没休眠过时两者相等）。
- **手机上直接点**：没有主机打标，从 trace 中找诊断窗口内的 `ACTION_DOWN`，取最后一次；有多次时列出供用户选择。

### 5.2 画面变化检测（T1 / T2）

在 `decoder.worker.ts` 中增加一个轻量的差分器，只在诊断布防期间运行：

- 每帧解码后，把 `VideoFrame` 缩到 64×N 灰度图（`OffscreenCanvas.drawImage` + `getImageData`，开销 < 1 ms），和上一帧比较**变化像素占比**。
- 屏蔽状态栏和导航栏区域（按 session 尺寸比例裁剪），避免时钟、信号图标干扰。
- **T1** = 点击之后第一帧变化占比 > 0.5% 的帧；**T2** = 之后连续 500 ms 变化占比 < 0.1% 的前一帧（画面稳定）。阈值可调；loading 动画会让画面一直变化，这时 T2 以“动画区域消失”或用户手动在时间轴上拖动修正为准。
- 帧时间换算到设备时间后，再对齐到 trace 里**最近的一次 SurfaceFlinger present**（`actual_frame_timeline_slice`），误差控制在 ±1 帧。
- 不投屏时退化为纯 trace 判定：T1 = 点击后目标 App 图层第一次上屏的帧；T2 不可用（需要用户手动标）。

### 5.3 环形 trace 与回溯（RingTraceSession）

在 `traceConfig.ts` 中新增 `response` 预设，在 `jank` 的基础上补充：

| 数据 | 配置 | 用途 |
|---|---|---|
| 调度 | `sched_switch` / `sched_waking` / `sched_blocked_reason` | 区分 Running / Runnable / Sleeping / D(IO) |
| atrace | `input view gfx am wm dalvik binder_driver res ss database network` + 目标 App 的 `atrace_apps` | 输入、doFrame、GC、binder、SQLite |
| binder | `binder/binder_transaction`、`binder_transaction_received`（ftrace） | 同步 binder 对端进程与耗时 |
| 锁 | ART `monitor contention`（dalvik atrace 自带） | 主线程等锁 |
| 帧 | `android.surfaceflinger.frametimeline`（12+） | 上屏时刻、jank 类型 |
| 网络 | `android.network_packets`（14+，按 uid/端口聚合）；更早版本退化为 `net/netif_receive_skb`、`sock/inet_sock_set_state` | 请求发出 / 响应到达时刻 |
| CPU | `cpu_frequency`、`cpu_idle`、thermal（`thermal/thermal_temperature`） | 降频、温控 |
| 内存 | `lowmemory_kill`、`mm_event`、kswapd 调度 | 内存压力 |

运行方式：

- 布防后以 `fill_policy: RING_BUFFER`、**不写文件**的方式常驻（默认 64 MB 缓冲，约覆盖 20–40 s）。
- 捕获时：Android 14+ 用 `perfetto --clone <session>` 克隆一份快照，**环形 trace 不中断**，可以连续诊断；更早版本停止当前会话、拉回文件，再自动重新布防（间隔约 1–2 s）。
- 这样“点完才意识到卡了”也能抓到：按“抓刚才”（全局快捷键，如 `⌘⇧D`），回溯最近 10 s。
- 布防期间 `MetricsService` 切到**低打扰模式**：停掉 `top` 和存储采集，CPU 与内存从 trace 的 `sys_stats` 中取，避免 Cockpit 自己的 shell 命令在 trace 里制造噪声（沿用 `pauseMetrics` 的思路）。

### 5.4 trace 自动分析（TraceAnalyzer）

- 随包分发 `trace_processor_shell`（mac arm64/x64、win x64），与 `fetch-perfetto` 脚本一起按版本下载并校验 SHA-256；以 `--httpd` 模式常驻，或每次 `-q query.sql` 输出 CSV。
- 分析以“**点击 → 关键帧**”这段时间窗为单位，查询都放在 `src/main/diagnosis/queries/*.sql`，便于用真实 trace 做快照测试。

主要查询：

1. **输入分发**：注入 → `InputDispatcher` 分发 → App `deliverInputEvent` 开始。超过 50 ms 说明 system_server 繁忙或上一个事件还没处理完。
2. **主线程状态分解**（核心）：对目标进程主线程，在 [点击, T2] 窗口内按 `thread_state` 统计：
   - `Running`：再按 slice 细分到 `Choreographer#doFrame`、`inflate`、`RV OnLayout`、`GC`、App 自定义 trace 段，没有覆盖到的部分计为“未打点的 App 代码”。
   - `Runnable` / `Runnable (Preempted)`：**等 CPU**，同时记录这段时间占用该 CPU 的进程/线程（`sched` 表反查）。
   - `Sleeping`：再按 `binder transaction` / `monitor contention` / looper 空闲（`nativePollOnce`）细分。
   - `Uninterruptible (D)`：IO，附 `blocked_function`。
3. **异步依赖**：主线程处于 looper 空闲时，找出在此期间被唤醒、并最终唤醒主线程（`sched_waking` 的 waker 链）的工作线程，这条唤醒链就是“主线程在等谁”。顺着链看工作线程在做什么：网络（socket 收发 / `network_packets`）、数据库（`database` atrace）、binder、文件 IO。
4. **出帧**：T1/T2 对应帧的 `doFrame` → `DrawFrame`（RenderThread）→ GPU 完成 → SF present，以及帧时间线的 jank 类型（`App Deadline Missed`、`Buffer Stuffing`、`SurfaceFlinger CPU Deadline Missed` 等）。
5. **系统背景**：窗口内各核利用率、频率（是否被压到低频）、温度、Top 5 进程 CPU 时间、LMK / kswapd 活动、GC 次数与耗时。

### 5.5 网络可见性（NetProbe），分级实现

“接口慢”是用户最关心、也最难证实的一项，按侵入程度分三级，自动选择能用的最高一级：

| 级别 | 方式 | 能看到什么 | 条件 |
|---|---|---|---|
| L1 | trace 内网络事件 + 唤醒链 | 某线程从发包到收包的时间、对端端口、字节数 | Android 14+ 效果最好，无需 root |
| L2 | 主机 HTTP 代理：`adb reverse` + `settings put global http_proxy`，Cockpit 内置一个 CONNECT 隧道代理 | **每个请求的域名**、建连 / TLS / 首字节 / 完成时间（HTTPS 不解密，只看隧道上的时间） | 用户在界面上明确开启；结束时恢复代理设置；需要 App 遵守系统代理 |
| L3 | root 下 `tcpdump -i any`（只抓 SYN/FIN 和长度，不存载荷）或读取 `/proc/net/tcp` 快照 | 连接级时间线、重传 | 已有 root 会话 |

- L2 会修改设备的全局设置，按设计文档的原则：开启前弹窗确认、写进操作日志、断开或退出时**必定恢复**（启动时检查上次是否残留）。
- 如果 App 自己用 `Trace.beginSection("api:/xxx")` 打点，L1 就能直接显示接口名。可以在报告里提示开发者接入。

### 5.6 归因规则引擎（Attribution）

输入是 §5.4 的时间分解，输出是**主因 + 次因 + 证据**。规则做成纯函数和数据表（`src/main/diagnosis/rules.ts`），可以单测，后续也方便调整阈值。

总时长 D = T2 − 点击（没有 T2 时用 T1）。每个类别算一个“占用时长”，取占比最大的作为主因，> 15% 的列为次因：

| 归因类别 | 判定依据（主要） | 证据展示 |
|---|---|---|
| **系统负载高 / CPU 抢占** | 主线程 Runnable 占比 > 20%；或窗口内大核平均占用 > 85% | 抢占者 Top 3（进程/线程/时长）、各核占用热图 |
| **降频 / 温控** | Running 时间长，且大核频率 < 最高频的 50% 或温度超过阈值 | 频率曲线、温度、thermal 事件 |
| **接口 / 网络慢** | 主线程以空闲为主，唤醒链指向的线程在等 socket；或 L2 请求时间覆盖了空闲区间 | 请求列表（域名、各阶段耗时），与主线程空闲区间对齐显示 |
| **App 主线程自身耗时** | Running 占比高，CPU 不忙，频率正常 | 最耗时的 slice / 未打点区间，“建议加 Trace 或用 Method Trace 复现” |
| **同步 binder / 系统服务慢** | 主线程 Sleeping 在 binder transaction，并且对端耗时长 | 对端进程、接口（AIDL 名）、对端线程当时的状态 |
| **IO / 数据库** | 主线程或唤醒链线程处于 D 状态，或 `database` 段时间长 | `blocked_function`、SQL 段 |
| **锁竞争** | `monitor contention` 段时间长 | 持锁线程、竞争锁的位置 |
| **GC / 内存压力** | GC 段、LMK、kswapd 活跃，或 `Alloc` 阻塞 | GC 次数与耗时、可用内存曲线 |
| **渲染 / GPU** | doFrame 正常但 RenderThread 或 GPU 完成超时，帧时间线标记 jank | 帧时间分解 |
| **输入分发延迟** | 点击 → App 收到 > 50 ms | InputDispatcher 队列、system_server 状态 |
| **无明显瓶颈** | 各段都正常但 D 很长：多半是 App 设计上的等待（定时器、动画、主动延迟） | 列出空闲区间，提示人工查看 |

额外检查：

- **首次反馈慢但内容就绪不慢**：说明点击后没有立即给出视觉反馈（缺按压态 / loading），属于交互设计问题，单独提示。
- 时间分解的各段之和必须等于 D，误差超过 10% 时在报告中标注“数据不完整”（例如缓冲被冲掉、版本不支持某数据源），不硬下结论。
- 置信度：每条结论都带“高 / 中 / 低”，取决于数据完整度（有没有帧时间线、网络是 L1 还是 L2 等）。

### 5.7 重复测量

单次点击偶然性大，“有时慢”的问题需要统计：

- 在诊断卡片上点“重复 N 次”：Cockpit 记录这次点击的坐标，可选录制前置步骤（例如返回上一页的按键序列，复用控制通道），自动重放 N 次（默认 10 次，间隔可配）。
- 输出 T1/T2 的分布（P50 / P90 / 最大值），并把**慢的几次和快的几次的时间分解放在一起对比**：例如“慢的 3 次里网络等待都 > 1.5 s，快的几次 < 200 ms → 接口偶发慢”，或“慢的那几次都碰上 `com.xx.sync` 在跑”。
- 支持冷 / 热两种模式：每次重放前是否 `am force-stop` 应用（复用 startup 预设的逻辑）。

## 6. 界面

在右侧工具条新增“响应诊断”面板（和 trace、日志面板同级），投屏工具栏增加一个“诊断”开关：

```
┌ 响应诊断 · Pixel 8 ──────────────────────── [● 已布防 回溯 30s] [抓刚才 ⌘⇧D] ┐
│ #12  14:03:21  com.example.shop / OrderActivity  点击 (540, 1820)              │
│ 首次反馈 86 ms ✓   内容就绪 2.41 s ✗   置信度 高                               │
│                                                                                │
│ 0        0.5s        1.0s        1.5s        2.0s       2.4s                    │
│ ▏输入 12ms                                                                       │
│ ▏▇主线程 28ms                                                                    │
│      ░░░░░░░░░░░░░░ 等待网络 1.93s (api.example.com /order/list) ░░░░░░░░         │
│                                                         ▇▇▇▇ 布局 310ms         │
│                                                              ▏出帧 18ms         │
│ CPU ▁▁▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▆█▇  温度 41℃  频率 正常                           │
│                                                                                │
│ 主因：接口慢（80%）  次因：主线程布局（13%，其中等 CPU 120ms）                 │
│ [▶ 视频片段] [在 Perfetto 中打开] [logcat ±5s] [重复 10 次] [导出报告]          │
└────────────────────────────────────────────────────────────────────────────────┘
```

- 瀑布图横轴与视频片段同步：拖动时间轴，视频跟着跳到对应帧，帧上标出 T1/T2。
- 点击瀑布图上的某一段，跳到 Perfetto 的对应区间（扩展现有 `TraceWindow`，并通过 URL 参数预先选中目标进程主线程）。
- 历史列表：每次诊断一张卡片，可以按应用 / 页面筛选，选两次做对比。
- 导出：一个文件夹，包含 `report.html`（自包含，方便发给开发者）、`trace.pftrace`、`clip.mp4`、`logcat.txt`、`report.json`。

## 7. 分期计划

先做阶段 M（实时监控增强），再做响应诊断 P0–P3。M 产出的前台识别、帧数据、事件标记和长历史，P0 起都会复用。

| 阶段 | 内容 | 产出 |
|---|---|---|
| **M1 看得清**（约 1.5 周） | 投屏 HUD；状态面板弹出为独立窗口；iowait、PSI、簇与限频、温控等级；进程表排序/搜索/固定；曲线联动、暂停、缩放 | 边操作边看负载，能看出“是不是被限频、有没有排队” |
| **M2 看应用**（约 2 周） | 前台应用识别；FPS / 掉帧 / 帧耗时分布（gfxinfo + timestats 兜底）；关注应用的 CPU / 内存 / 线程曲线；事件标记（输入、切换、崩溃、ANR、大卡顿、操作日志、手动打点） | 有流畅度指标和单应用视角，曲线能和操作对上 |
| **M3 留得住**（约 1.5 周） | 30 分钟历史与降采样；会话录制（NDJSON）与回看；CSV / JSON 导出；告警规则与告警历史 | 能回看、能导出、不用一直盯着 |
| **P0 打通链路**（约 2 周） | `response` trace 预设；投屏点击打标；ClockSync；点击后定时停止并拉回 trace；在 Perfetto 中自动缩放到点击窗口 | 能“点一下 → 直接看到这一次的 trace” |
| **P1 自动分析**（约 3 周） | 打包 trace_processor；主线程状态分解、输入/出帧 SQL；帧差分 T1/T2；归因规则（CPU 抢占 / 降频 / 主线程耗时 / binder / IO / 锁 / GC / 渲染）；瀑布图与诊断卡片 | 能回答“负载高 还是 App 自己慢” |
| **P2 网络与回溯**（约 2–3 周） | 唤醒链分析；L1 网络事件；L2 代理探针；环形 trace + `--clone` 回溯；“抓刚才”快捷键；手机上直接点的识别 | 能回答“是不是接口慢”，事后也能抓 |
| **P3 统计与报告**（约 2 周） | 重复测量与分布对比；历史与对比；导出 HTML 报告；多设备同时诊断对比（例如同一操作在高端机和低端机上的差异） | 用于回归测试和给开发者提单 |

每阶段都用真实设备录一组样本 trace（构造 CPU 压测、`sleep` 接口、主线程 `Thread.sleep`、大量 binder 等场景）作为 SQL 和规则的快照测试，放进 `src/main/diagnosis/__fixtures__`。

## 8. 风险与限制

| 风险 | 影响 | 应对 |
|---|---|---|
| scrcpy PTS 是否减去起始值未确认 | T1/T2 映射到设备时间的方式不同 | P0 先验证，减了就走标定方案 |
| Android 10–11 没有帧时间线、Android 13 及以下没有 `network_packets` | 出帧和网络段精度下降 | 降级到 atrace `DrawFrame` 和唤醒链，报告里标注置信度 |
| 环形 trace 常驻有开销（约 2–5% CPU） | 轻微影响被测设备 | 只在布防期间运行；报告中注明“诊断期间开启了 trace” |
| 投屏编码本身占用 CPU / GPU | 低端机上可能加重卡顿 | 诊断模式可切到“仅打标不解码”（只保留控制通道）；或降低投屏分辨率 |
| L2 代理修改全局设置 | 残留会导致设备断网 | 确认弹窗 + 操作日志 + 退出时恢复 + 启动时检查残留 |
| Release 包没有 App 自定义 trace | “App 自身耗时”只能落到“未打点代码” | 提示用 debuggable 包或接入 `androidx.tracing`；P3 可选用 `am profile`/simpleperf 采样补充调用栈 |
| 被测 App 不走系统代理 / 使用 QUIC | L2 看不到请求 | 自动退回 L1/L3，并在报告中说明 |
| `gfxinfo framestats` 只覆盖 HWUI 渲染 | 游戏、Flutter、SurfaceView 没有 FPS | 退到 SurfaceFlinger timestats；仍取不到时 HUD 显示“该应用不支持帧统计” |
| 各厂商 `dumpsys activity` 输出格式不同 | 前台应用识别失败 | 同时匹配 `topResumedActivity` / `mResumedActivity` / `mFocusedApp`，用解析测试覆盖多家样本 |
| 新增采集增加设备负担 | 测出来的负载里有 Cockpit 自己的份 | 合并命令、仅可见时采集（见 §3.7）；进程表里把 Cockpit 自己的 shell 进程标灰 |
| 版本差异导致 trace 配置字段不被识别 | 整个录制失败 | 延续现有做法，按 SDK 版本拼配置（参见 `traceConfig.ts` 中的 `COMPACT_SCHED_SDK` 等） |

## 9. 待确认

1. 被测 App 是否可以接入 `Trace.beginSection` 打点（尤其是网络层拦截器），这会显著提升“接口慢”的结论质量。
2. L2 代理探针是否可以接受修改设备的全局代理设置。
3. `trace_processor_shell` 随包增加约 20–30 MB 体积，是否接受；不接受的话可以改为首次使用时下载。
4. 是否需要无投屏场景（比如只连 adb 跑自动化脚本）也能诊断。现方案通过“手机上直接点 + 回溯”可以支持，但没有 T2。
5. 告警的默认阈值（§3.6）是否符合你们测试的机型和场景，例如温度阈值在游戏测试里可能需要调高。
6. 会话录制的数据默认保存多久，是否需要自动清理。
