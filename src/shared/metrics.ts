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
  gpu?: AcceleratorLoad
  /** 设备没有 NPU 节点时为 undefined */
  npu?: AcceleratorLoad
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

export interface MetricsSnapshot {
  serial: string
  /** 环形缓冲中的负载历史，按时间升序 */
  history: LoadSample[]
  processes?: ProcessInfo[]
  storage?: StorageMount[]
  error?: string
}

export type MetricsEvent =
  | { type: 'load'; serial: string; sample: LoadSample }
  | { type: 'processes'; serial: string; processes: ProcessInfo[] }
  | { type: 'storage'; serial: string; storage: StorageMount[] }
  | { type: 'error'; serial: string; error: string }
