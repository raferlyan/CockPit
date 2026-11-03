/** 登记给内嵌 Perfetto UI 的本机 trace */
export interface TraceSource {
  /** 本地服务上的地址，交给 Perfetto 的 `?url=` 加载 */
  url: string
  /** 文件名 */
  name: string
  /** 字节数 */
  size: number
  /** 打开后先缩放到这段时间 */
  window?: TraceWindow
}

/**
 * trace 时间轴上的一段，单位是设备 CLOCK_BOOTTIME 纳秒（与 trace 里的时间戳一致）。
 * 帧时间线等数据源会带进录制开始前几秒的数据，打开时直接缩放到实际录制的这段
 */
export interface TraceWindow {
  start: string
  end: string
}

/** trace 目录里的一个文件 */
export interface TraceFile {
  path: string
  name: string
  size: number
  /** 修改时间，毫秒时间戳 */
  mtime: number
}

export type TracePreset = 'jank' | 'startup' | 'memory' | 'power'

export interface TracePresetInfo {
  id: TracePreset
  label: string
  description: string
  defaultDurationSec: number
  /** required：必须指定应用（启动分析会自动冷启动它）；optional：指定后只抓这个应用的 atrace 埋点 */
  app: 'required' | 'optional' | 'none'
}

export const TRACE_PRESETS: TracePresetInfo[] = [
  {
    id: 'jank',
    label: '卡顿 / 流畅度',
    description: 'CPU 调度与频率、渲染与输入的 atrace、SurfaceFlinger 帧时间线（Android 12+）。复现卡顿时录制。',
    defaultDurationSec: 10,
    app: 'optional'
  },
  {
    id: 'startup',
    label: '应用启动',
    description: '开始录制后自动强制停止并冷启动所选应用，分析启动耗时和主线程阻塞。',
    defaultDurationSec: 10,
    app: 'required'
  },
  {
    id: 'memory',
    label: '内存',
    description: '系统 meminfo / vmstat、各进程内存曲线、RSS 变化、低内存查杀（LMK）事件。',
    defaultDurationSec: 30,
    app: 'none'
  },
  {
    id: 'power',
    label: '功耗',
    description: '电池电量与电流、Power Rails（设备支持时）、CPU 频率与休眠状态、唤醒与挂起。',
    defaultDurationSec: 30,
    app: 'none'
  }
]

export const TRACE_BUFFER_OPTIONS_MB = [32, 64, 128, 256]
export const TRACE_MAX_DURATION_SEC = 600

export interface TraceRecordOptions {
  preset: TracePreset
  durationSec: number
  bufferMb: number
  /** 包名 */
  app?: string
  /** 同时记录 logcat */
  logcat: boolean
  /** 录制期间暂停这台设备的状态采集，避免 Cockpit 自己的 shell 命令混进 trace */
  pauseMetrics: boolean
}

export type TraceRecordState = 'starting' | 'recording' | 'stopping' | 'pulling' | 'done' | 'error'

/** 主进程推送的录制进度，每台设备同时只有一个录制 */
export interface TraceRecordEvent {
  serial: string
  state: TraceRecordState
  preset: TracePreset
  durationMs: number
  /** 进入 recording 状态的时间 */
  startedAt?: number
  /** done 时为保存到本机的文件 */
  file?: TraceFile
  /** done 时实际录制的时间段 */
  window?: TraceWindow
  /** error 时的原因；其它状态下的附加说明 */
  message?: string
}
