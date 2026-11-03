import type { TraceRecordOptions } from '@shared/trace'

/** 文本格式配置（--txt）从 Android 10 开始支持 */
export const MIN_SDK = 29
/** Android 11 起 traced 默认启用，更早的版本需要 setprop persist.traced.enable 1 */
export const TRACED_DEFAULT_SDK = 30
/** compact_sched、record_thread_names 等字段从 Android 11 开始支持；配置里出现不认识的字段整个录制会失败 */
const COMPACT_SCHED_SDK = 30
/** SurfaceFlinger 帧时间线从 Android 12 开始提供 */
const FRAMETIMELINE_SDK = 31

const SCHED_EVENTS = [
  'sched/sched_switch',
  'sched/sched_waking',
  'sched/sched_wakeup_new',
  'sched/sched_process_exit',
  'sched/sched_process_free',
  'task/task_newtask',
  'task/task_rename'
]
const FREQ_EVENTS = ['power/cpu_frequency', 'power/cpu_idle', 'power/suspend_resume']
const MEMORY_EVENTS = ['kmem/rss_stat', 'mm_event/mm_event_record', 'lowmemorykiller/lowmemory_kill', 'oom/oom_score_adj_update']
const UI_ATRACE = ['gfx', 'view', 'input', 'am', 'wm', 'dalvik', 'binder_driver', 'hal', 'res', 'ss', 'sched', 'freq']
const STARTUP_ATRACE = [...UI_ATRACE, 'pm', 'aidl', 'bionic']

/** 包名只允许字母数字、点和下划线，防止拼进配置或 shell 命令时被注入 */
export function isPackageName(value: string): boolean {
  return /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(value)
}

function ftrace(sdk: number, events: string[], atrace: string[], apps: string[]): string {
  const lines = [
    ...events.map((e) => `ftrace_events: "${e}"`),
    ...atrace.map((c) => `atrace_categories: "${c}"`),
    ...apps.map((a) => `atrace_apps: "${a}"`),
    'buffer_size_kb: 16384',
    'drain_period_ms: 250'
  ]
  // 调度事件量大，压缩格式能省一半以上的缓冲
  if (sdk >= COMPACT_SCHED_SDK) lines.push('compact_sched { enabled: true }')
  return source('linux.ftrace', 0, `ftrace_config {\n${indent(lines)}\n}`)
}

function processStats(sdk: number, pollMs?: number): string {
  const lines = ['scan_all_processes_on_start: true']
  if (sdk >= COMPACT_SCHED_SDK) lines.push('record_thread_names: true')
  if (pollMs) lines.push(`proc_stats_poll_ms: ${pollMs}`)
  return source('linux.process_stats', 1, `process_stats_config {\n${indent(lines)}\n}`)
}

function sysStats(): string {
  const lines = [
    'meminfo_period_ms: 1000',
    ...['MEM_TOTAL', 'MEM_FREE', 'MEM_AVAILABLE', 'BUFFERS', 'CACHED', 'SWAP_TOTAL', 'SWAP_FREE', 'ACTIVE', 'INACTIVE', 'MAPPED', 'SHMEM'].map(
      (c) => `meminfo_counters: MEMINFO_${c}`
    ),
    'vmstat_period_ms: 1000',
    ...['NR_FREE_PAGES', 'PGFAULT', 'PGMAJFAULT', 'PSWPIN', 'PSWPOUT', 'ALLOCSTALL'].map((c) => `vmstat_counters: VMSTAT_${c}`),
    'stat_period_ms: 1000',
    'stat_counters: STAT_CPU_TIMES',
    'stat_counters: STAT_FORK_COUNT'
  ]
  return source('linux.sys_stats', 0, `sys_stats_config {\n${indent(lines)}\n}`)
}

function power(): string {
  const lines = [
    'battery_poll_ms: 1000',
    // BATTERY_COUNTER_VOLTAGE 在 Android 12 上还不认识
    ...['CHARGE', 'CAPACITY_PERCENT', 'CURRENT', 'CURRENT_AVG'].map((c) => `battery_counters: BATTERY_COUNTER_${c}`),
    'collect_power_rails: true'
  ]
  return source('android.power', 0, `android_power_config {\n${indent(lines)}\n}`)
}

function logcat(): string {
  return source('android.log', 0, `android_log_config {\n${indent(['log_ids: LID_DEFAULT', 'log_ids: LID_SYSTEM', 'log_ids: LID_CRASH', 'log_ids: LID_EVENTS'])}\n}`)
}

function source(name: string, buffer: number, body?: string): string {
  const lines = [`name: "${name}"`, `target_buffer: ${buffer}`]
  if (body) lines.push(body)
  return `data_sources {\n  config {\n${indent(lines, 4)}\n  }\n}`
}

function indent(lines: string[], spaces = 2): string {
  const pad = ' '.repeat(spaces)
  return lines.flatMap((l) => l.split('\n')).map((l) => pad + l).join('\n')
}

/**
 * 生成 perfetto 文本格式配置。
 * 缓冲 0 放主要数据（环形覆盖），缓冲 1 固定 2 MB 放进程表，避免长录制时进程名被冲掉。
 * 边录边写文件（write_into_file），录制时长不受内存缓冲大小限制。
 */
export function buildTraceConfig(options: TraceRecordOptions, sdk: number): string {
  const apps = options.app && isPackageName(options.app) ? [options.app] : []
  const sources: string[] = []
  switch (options.preset) {
    case 'jank':
      sources.push(ftrace(sdk, [...SCHED_EVENTS, ...FREQ_EVENTS], UI_ATRACE, apps.length ? apps : ['*']), processStats(sdk))
      if (sdk >= FRAMETIMELINE_SDK) sources.push(source('android.surfaceflinger.frametimeline', 0))
      break
    case 'startup':
      sources.push(ftrace(sdk, [...SCHED_EVENTS, ...FREQ_EVENTS], STARTUP_ATRACE, apps.length ? apps : ['*']), processStats(sdk))
      if (sdk >= FRAMETIMELINE_SDK) sources.push(source('android.surfaceflinger.frametimeline', 0))
      break
    case 'memory':
      sources.push(ftrace(sdk, [...SCHED_EVENTS, ...MEMORY_EVENTS], ['am', 'dalvik'], []), processStats(sdk, 1000), sysStats())
      break
    case 'power':
      sources.push(ftrace(sdk, [...SCHED_EVENTS, ...FREQ_EVENTS], ['power', 'am'], []), processStats(sdk), sysStats(), power())
      break
  }
  if (options.logcat) sources.push(logcat())

  return [
    `buffers {\n  size_kb: ${Math.round(options.bufferMb * 1024)}\n  fill_policy: RING_BUFFER\n}`,
    'buffers {\n  size_kb: 2048\n  fill_policy: RING_BUFFER\n}',
    ...sources,
    `duration_ms: ${Math.round(options.durationSec * 1000)}`,
    'write_into_file: true',
    'file_write_period_ms: 2500',
    'flush_period_ms: 10000'
  ].join('\n')
}
