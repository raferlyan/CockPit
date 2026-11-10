/** 负载类指标，默认每秒一条；某项取不到时为 undefined，界面隐藏对应内容 */
export interface LoadSample {
  /** 采样时间，毫秒时间戳（主机时间） */
  t: number
  cpu?: {
    /** 总占用 0–100 */
    total: number
    /** 每核占用 0–100，下标即核号；离线核为 null */
    cores: (number | null)[]
    /** 每核当前频率 MHz，取不到为 null */
    freqMHz: (number | null)[]
    /** IO 等待占比 0–100；已计入空闲，不包含在 total 里 */
    iowait?: number
    /** 按硬件最高频率划分的簇，小核在前；读不到 cpuinfo_max_freq 时为 undefined */
    clusters?: CpuCluster[]
  }
  memory?: {
    totalKB: number
    availableKB: number
    swapTotalKB: number
    swapFreeKB: number
  }
  /** 摄氏度，按传感器类别取最大值 */
  thermal?: {
    cpu?: number
    gpu?: number
    battery?: number
    skin?: number
  }
  battery?: BatteryState
  /**
   * 网卡吞吐，字节/秒：所有物理网卡（排除回环、隧道、VPN 等虚拟接口）之和。
   * 经 Wi-Fi adb 连接时，adb 自身（投屏、终端）的流量也会算在 wlan 上。
   */
  net?: { rxBps: number; txBps: number; ifaces: NetIface[] }
  loadavg?: [number, number, number]
  /**
   * 资源压力（PSI some avg10），0–100：最近 10 秒里至少有一个任务在等这项资源的时间占比。
   * 比占用率更能说明“有活在排队”。内核或 SELinux 不支持时为 undefined
   */
  psi?: { cpu?: number; memory?: number; io?: number }
  /** 系统温控等级（PowerManager.THERMAL_STATUS_*）：0 无 … 6 关机；读不到为 undefined */
  thermalStatus?: number
  gpu?: AcceleratorLoad
  /** 设备没有 NPU 节点时为 undefined */
  npu?: AcceleratorLoad
}

/** 一组硬件最高频率相同的核（小核 / 中核 / 大核） */
export interface CpuCluster {
  cores: number[]
  /** 硬件最高频率 cpuinfo_max_freq */
  maxMHz: number
  /** 当前允许的最高频率（簇内 scaling_max_freq 最小值），被温控或省电策略压低时小于 maxMHz */
  limitMHz: number
}

/** 频率上限低于硬件最高频率这个比例就算限频，留一点余量避免把正常的档位差当成限频 */
export const THROTTLE_RATIO = 0.95

export function isThrottled(cluster: CpuCluster): boolean {
  return cluster.limitMHz < cluster.maxMHz * THROTTLE_RATIO
}

/**
 * GPU / NPU 负载。这些节点没有统一标准，且多数量产机只允许 root 读取：
 * - ok：读到了占用率
 * - needs-root：当前不是 root，读不到，进入 root 后可能可以
 * - unavailable：已经是 root 仍读不到，驱动没有提供占用数据
 */
export interface AcceleratorLoad {
  access: 'ok' | 'needs-root' | 'unavailable'
  /** 占用 0–100；多核为平均值 */
  busy?: number
  /** 每核占用，只有驱动分核上报时才有 */
  cores?: number[]
  freqMHz?: number
  model?: string
}

export interface NetIface {
  name: string
  /** 接口处于 up 状态 */
  up: boolean
  rxBps: number
  txBps: number
}

export type BatteryStatus = 'charging' | 'discharging' | 'not-charging' | 'full' | 'unknown'

export interface BatteryState {
  level: number
  /** 摄氏度 */
  temperature: number
  /** 毫伏 */
  voltage: number
  status: BatteryStatus
  /** 供电来源，如 AC / USB / Wireless；未接电源为空数组 */
  power: string[]
}

export interface ProcessInfo {
  pid: number
  user: string
  cpu: number
  resKB: number
  name: string
}

export interface StorageMount {
  /** 挂载点，如 /data */
  mount: string
  sizeKB: number
  usedKB: number
  availKB: number
}

/** 前台（最上层已恢复）的 Activity */
export interface ForegroundApp {
  pkg: string
  /** 完整类名，如 com.android.settings.Settings */
  activity: string
}

/**
 * 关注应用每秒一条：同一包名的所有进程（含 :push 等子进程）合计。
 * cpu 是占整机的百分比（0–100），和系统 CPU 曲线同一口径，可以直接对比。
 */
export interface AppSample {
  t: number
  pkg: string
  pids: number[]
  cpu?: number
  rssKB?: number
  threads?: number
  /** dumpsys meminfo 的 TOTAL PSS（只含主进程），每 10 秒更新一次，其余时间沿用上次的值 */
  pssKB?: number
}

export interface ThreadInfo {
  tid: number
  /** top 的 %CPU，单核口径（满载一个核为 100） */
  cpu: number
  name: string
}

/**
 * 前台应用的帧统计，每秒一条。
 * - hwui：dumpsys gfxinfo framestats，有每帧耗时（View / Compose）
 * - sf：SurfaceFlinger timestats 按图层统计，只有帧数和卡顿帧数（SurfaceView、游戏、Flutter）
 */
export interface FrameStats {
  t: number
  pkg: string
  source: 'hwui' | 'sf'
  /** 这一秒里画完的帧数 */
  fps: number
  /** 画面静止：这一秒没有新帧（不是卡死，只是不需要重绘） */
  idle: boolean
  /** 卡顿帧占比 0–100：超过截止时间才画完的帧；没有新帧时为 undefined */
  jankRatio?: number
  /** 刷新率，Hz */
  refreshHz?: number
  /** 最近最多 120 帧的耗时（毫秒，按时间先后），仅 hwui */
  recent?: number[]
  /** 最近帧耗时的分位数（毫秒），仅 hwui */
  p50?: number
  p90?: number
  p99?: number
  /** 这一秒里最慢的一帧（毫秒），仅 hwui */
  worstMs?: number
}

/** 时间轴上的事件，画在所有曲线上 */
export type MarkerKind = 'input' | 'foreground' | 'process' | 'crash' | 'anr' | 'lmk' | 'jank' | 'operation' | 'manual' | 'alert'

/**
 * label 只放主体（包名、Activity、毫秒数、操作名的中文原文），界面按 kind 拼上前缀并翻译：
 * input / operation 的 label 是可翻译的中文原文；foreground 是包名或 Activity；
 * crash / anr / lmk / process 是进程名；jank 是毫秒数；manual 是用户备注（可为空）；
 * alert 是告警规则 id（见 AlertRuleId），detail 是触发时的读数。
 */
export interface MetricsMarker {
  id: number
  t: number
  kind: MarkerKind
  label: string
  detail?: string
  /** process 类：进程启动还是结束 */
  action?: 'start' | 'kill'
  /** alert 类：条件已解除 */
  resolved?: boolean
}

/** 每台设备的关注应用：pinned 为空时跟随前台应用 */
export interface FocusState {
  pinned?: string
  /** 实际在采集的包名 */
  pkg?: string
}

export interface MetricsSnapshot {
  serial: string
  /** 环形缓冲中的负载历史，按时间升序 */
  history: LoadSample[]
  processes?: ProcessInfo[]
  storage?: StorageMount[]
  error?: string
  foreground?: ForegroundApp
  focus?: FocusState
  appHistory?: AppSample[]
  frameHistory?: FrameStats[]
  threads?: ThreadInfo[]
  markers?: MetricsMarker[]
}

/** 正在录制的会话 */
export interface MetricsRecordingState {
  path: string
  startedAt: number
}

/** 录制目录里的一个文件 */
export interface MetricsRecordingFile {
  path: string
  name: string
  size: number
  /** 修改时间，毫秒时间戳 */
  mtime: number
}

/** 读回来的录制会话，结构与实时数据一致，状态面板可以直接显示 */
export interface RecordedSession {
  name: string
  serial: string
  device?: string
  startedAt?: number
  history: LoadSample[]
  appHistory: AppSample[]
  frameHistory: FrameStats[]
  markers: MetricsMarker[]
  foreground?: ForegroundApp
  focus?: FocusState
}

export type MetricsEvent =
  | { type: 'load'; serial: string; sample: LoadSample }
  | { type: 'processes'; serial: string; processes: ProcessInfo[] }
  | { type: 'storage'; serial: string; storage: StorageMount[] }
  | { type: 'error'; serial: string; error: string }
  | { type: 'foreground'; serial: string; foreground: ForegroundApp | null }
  | { type: 'focus'; serial: string; focus: FocusState }
  | { type: 'app'; serial: string; sample: AppSample }
  | { type: 'frames'; serial: string; stats: FrameStats }
  | { type: 'threads'; serial: string; threads: ThreadInfo[] }
  | { type: 'marker'; serial: string; marker: MetricsMarker }
  | { type: 'recording'; serial: string; recording: MetricsRecordingState | null }
