import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ControlInput } from '@shared/mirror'
import type { AppSample, FocusState, ForegroundApp, FrameStats, MarkerKind, MetricsEvent, MetricsMarker, MetricsSnapshot, ThreadInfo } from '@shared/metrics'
import type { AdbClient } from '../adb/AdbClient'
import { isPackageName } from '../trace/traceConfig'
import { SEP } from './parsers'
import {
  appProcCommand,
  EVENT_LOG_ARGS,
  foregroundCommand,
  framesCommand,
  FrameTracker,
  meminfoCommand,
  parseAppProc,
  parseEventLog,
  parseForeground,
  parseFramestats,
  parseMeminfoPss,
  parsePids,
  parseThreads,
  parseTimestats,
  threadsCommand,
  TIMESTATS_DISABLE,
  TIMESTATS_DUMP,
  TIMESTATS_ENABLE,
  type FrameWindow
} from './appParsers'

const FOREGROUND_INTERVAL = 2_000
const FRAMES_INTERVAL = 1_000
const THREADS_INTERVAL = 3_000
const MEMINFO_INTERVAL = 10_000
const COMMAND_TIMEOUT = 5_000
/** 与负载历史一样保留 30 分钟 */
const HISTORY_SIZE = 1800
/** 标记保留条数，够覆盖 30 分钟内频繁操作 */
const MARKER_LIMIT = 1000
/** 连续这么多秒没有 HWUI 新帧，就打开 SurfaceFlinger 统计看是不是 SurfaceView / 游戏在画 */
const IDLE_BEFORE_SF = 3
/** 单帧超过这么久打“大卡顿”标记 */
const BIG_JANK_MS = 100
/** 同类输入在这段时间内合并成一个标记 */
const INPUT_MERGE_MS = 1_000
const EVENT_LOG_RETRY = 5_000

export type Every = (name: string, interval: number, task: () => Promise<void>) => void

/**
 * 每台设备的应用视角：前台应用、关注应用（CPU / 内存 / 线程）、帧统计和时间轴事件。
 * 关注应用默认跟随前台，固定后不再随前台切换。帧统计只在界面上有人看时才采（gfxinfo 每次都要
 * 对目标进程发 binder 调用），由 setFramesWanted 控制。
 */
export class AppMonitor {
  foreground?: ForegroundApp
  /** 第一次读到前台应用时不打标记：那不是“切换” */
  private foregroundKnown = false
  private pinned?: string
  private pkg?: string
  private pids: number[] = []
  /** 上一次查进程时用的包名：查询结果晚一轮返回，包名已经变了的话就丢掉 */
  private prevProc?: { ticks: number; total: number }
  private pss?: number
  private threads?: ThreadInfo[]
  private readonly appHistory: AppSample[] = []
  private readonly frameHistory: FrameStats[] = []
  private readonly markers: MetricsMarker[] = []
  private markerId = 0
  private lastInput?: { kind: string; t: number }
  private lastJankMarker = 0

  private framesWanted = false
  private frameTracker = new FrameTracker()
  private framePkg?: string
  private idleSeconds = 0
  private timestats = false
  private timestatsAt = 0

  private eventLog?: ChildProcessWithoutNullStreams
  private eventLogTimer?: NodeJS.Timeout
  private running = false

  constructor(
    private readonly adb: AdbClient,
    private readonly serial: string,
    private readonly emit: (event: MetricsEvent) => void
  ) {}

  start(every: Every): void {
    this.running = true
    every('foreground', FOREGROUND_INTERVAL, () => this.collectForeground())
    every('frames', FRAMES_INTERVAL, () => this.collectFrames())
    every('threads', THREADS_INTERVAL, () => this.collectThreads())
    every('appMemory', MEMINFO_INTERVAL, () => this.collectMemory())
    this.startEventLog()
  }

  stop(): void {
    this.running = false
    this.prevProc = undefined
    this.frameTracker = new FrameTracker()
    void this.disableTimestats()
    clearTimeout(this.eventLogTimer)
    this.eventLog?.kill()
    this.eventLog = undefined
  }

  snapshot(): Pick<MetricsSnapshot, 'foreground' | 'focus' | 'appHistory' | 'frameHistory' | 'threads' | 'markers'> {
    return {
      foreground: this.foreground,
      focus: this.focus(),
      appHistory: [...this.appHistory],
      frameHistory: [...this.frameHistory],
      threads: this.threads,
      markers: [...this.markers]
    }
  }

  /* ---------------- 对外的控制 ---------------- */

  /** 固定关注某个应用；传 undefined 恢复跟随前台 */
  setPinned(pkg: string | undefined): void {
    if (pkg !== undefined && !isPackageName(pkg)) throw new Error(`包名格式不对：${pkg}`)
    this.pinned = pkg
    this.updateFocus()
  }

  setFramesWanted(wanted: boolean): void {
    if (this.framesWanted === wanted) return
    this.framesWanted = wanted
    if (!wanted) {
      this.frameTracker = new FrameTracker()
      void this.disableTimestats()
    }
  }

  /** 投屏的控制输入：触摸、按键、滚轮各自合并，避免一次滑动打几十个标记 */
  noteInput(input: ControlInput): void {
    const kind =
      input.type === 'touch' && input.action === 'down'
        ? '触摸'
        : input.type === 'key' && input.action === 'down'
          ? '按键'
          : input.type === 'scroll'
            ? '滚动'
            : input.type === 'text' || input.type === 'pasteText' || input.type === 'pasteFromHost'
              ? '输入文字'
              : input.type === 'backOrScreenOn' && input.action === 'down'
                ? '返回'
                : undefined
    if (!kind) return
    const t = Date.now()
    if (this.lastInput && this.lastInput.kind === kind && t - this.lastInput.t < INPUT_MERGE_MS) {
      this.lastInput.t = t
      return
    }
    this.lastInput = { kind, t }
    this.mark('input', kind)
  }

  mark(kind: MarkerKind, label: string, detail?: string, extra?: Pick<MetricsMarker, 'action' | 'resolved'>): MetricsMarker {
    const marker: MetricsMarker = { id: ++this.markerId, t: Date.now(), kind, label, detail, ...extra }
    this.markers.push(marker)
    if (this.markers.length > MARKER_LIMIT) this.markers.shift()
    this.emit({ type: 'marker', serial: this.serial, marker })
    return marker
  }

  /* ---------------- 关注应用：由每秒的负载命令顺带采集 ---------------- */

  /** 追加到负载命令末尾的两段 */
  procCommand(): [string, string] {
    return appProcCommand(this.pids)
  }

  /** totalJiffies 为同一次命令里 /proc/stat 的总时间，两者差值相除得到占整机的 CPU 百分比 */
  onLoad(t: number, totalJiffies: number | undefined, statText: string, statusText: string): void {
    const pkg = this.pkg
    if (!pkg || !this.pids.length) return
    const procs = parseAppProc(statText, statusText)
    if (!procs.size) return
    let ticks = 0
    let rssKB = 0
    let threads = 0
    for (const p of procs.values()) {
      ticks += p.ticks
      rssKB += p.rssKB ?? 0
      threads += p.threads ?? 0
    }
    const sample: AppSample = { t, pkg, pids: [...procs.keys()], rssKB: rssKB || undefined, threads: threads || undefined, pssKB: this.pss }
    const prev = this.prevProc
    if (prev && totalJiffies !== undefined && totalJiffies > prev.total && ticks >= prev.ticks) {
      sample.cpu = Math.min(100, ((ticks - prev.ticks) / (totalJiffies - prev.total)) * 100)
    }
    // 进程重启时 ticks 会变小，这一轮只记基线
    this.prevProc = totalJiffies !== undefined ? { ticks, total: totalJiffies } : undefined
    push(this.appHistory, sample)
    this.emit({ type: 'app', serial: this.serial, sample })
  }

  /* ---------------- 前台应用 ---------------- */

  private async collectForeground(): Promise<void> {
    const queried = this.pkg
    const out = await this.adb.shell(this.serial, foregroundCommand(queried), { timeout: COMMAND_TIMEOUT })
    const [activityText = '', psText = ''] = out.split(SEP)
    const next = parseForeground(activityText)
    const prev = this.foreground
    if (next?.pkg !== prev?.pkg || next?.activity !== prev?.activity) {
      this.foreground = next
      this.emit({ type: 'foreground', serial: this.serial, foreground: next ?? null })
      if (!this.foregroundKnown) this.foregroundKnown = true
      else if (next && prev && next.pkg === prev.pkg) this.mark('foreground', shortActivity(next.activity), next.activity)
      else if (next) this.mark('foreground', next.pkg, next.activity)
      this.updateFocus()
    }
    if (queried && queried === this.pkg) {
      const pids = parsePids(psText, queried)
      if (pids.join() !== this.pids.join()) {
        this.pids = pids
        this.prevProc = undefined
      }
    }
  }

  private focus(): FocusState {
    return { pinned: this.pinned, pkg: this.pkg }
  }

  private updateFocus(): void {
    const pkg = this.pinned ?? this.foreground?.pkg
    if (pkg === this.pkg) {
      this.emit({ type: 'focus', serial: this.serial, focus: this.focus() })
      return
    }
    this.pkg = pkg
    this.pids = []
    this.prevProc = undefined
    this.pss = undefined
    this.threads = undefined
    this.emit({ type: 'focus', serial: this.serial, focus: this.focus() })
    // 新的关注应用马上查一次进程，不用等下一轮
    if (this.running && pkg) void this.collectForeground().catch(() => undefined)
  }

  /* ---------------- 关注应用的内存与线程 ---------------- */

  private async collectMemory(): Promise<void> {
    const pkg = this.pkg
    const command = pkg && this.pids.length ? meminfoCommand(pkg) : undefined
    if (!command) return
    const pss = parseMeminfoPss(await this.adb.shell(this.serial, command, { timeout: COMMAND_TIMEOUT }))
    if (pkg === this.pkg) this.pss = pss
  }

  private async collectThreads(): Promise<void> {
    const pids = this.pids
    if (!pids.length) return
    const threads = parseThreads(await this.adb.shell(this.serial, threadsCommand(pids), { timeout: COMMAND_TIMEOUT }))
    if (pids !== this.pids) return
    this.threads = threads
    this.emit({ type: 'threads', serial: this.serial, threads })
  }

  /* ---------------- 帧统计 ---------------- */

  private async collectFrames(): Promise<void> {
    const pkg = this.foreground?.pkg
    if (!this.framesWanted || !pkg) return
    if (pkg !== this.framePkg) {
      this.framePkg = pkg
      this.frameTracker = new FrameTracker()
      this.idleSeconds = 0
      await this.disableTimestats()
    }
    const hwuiCommand = framesCommand(pkg)
    if (!hwuiCommand) return
    const command = this.timestats ? `${hwuiCommand}; echo ${SEP}; ${TIMESTATS_DUMP}` : hwuiCommand
    const out = await this.adb.shell(this.serial, command, { timeout: COMMAND_TIMEOUT })
    if (pkg !== this.foreground?.pkg) return
    const now = Date.now()
    const [hwuiText = '', sfText = ''] = out.split(SEP)
    const window = this.frameTracker.ingest(parseFramestats(hwuiText), now)
    this.idleSeconds = window.idle ? this.idleSeconds + 1 : 0

    let stats: FrameStats = this.hwuiStats(pkg, now, window)
    if (this.timestats) {
      const seconds = Math.max(0.2, (now - this.timestatsAt) / 1000)
      this.timestatsAt = now
      const layers = parseTimestats(sfText, pkg)
      if (!window.idle) await this.disableTimestats()
      else if (layers && layers.frames > 0) {
        stats = {
          t: now,
          pkg,
          source: 'sf',
          fps: Math.round((layers.frames / seconds) * 10) / 10,
          idle: false,
          jankRatio: layers.timelineFrames ? (layers.janky / layers.timelineFrames) * 100 : undefined,
          refreshHz: layers.refreshHz ?? window.refreshHz
        }
      }
    } else if (this.idleSeconds >= IDLE_BEFORE_SF) {
      // HWUI 静止了几秒：可能真的静止，也可能是 SurfaceView / 游戏在画，打开 SurfaceFlinger 统计确认
      await this.adb.shell(this.serial, TIMESTATS_ENABLE, { timeout: COMMAND_TIMEOUT })
      this.timestats = true
      this.timestatsAt = Date.now()
    }

    if (window.worstMs !== undefined && window.worstMs >= BIG_JANK_MS && now - this.lastJankMarker > FRAMES_INTERVAL * 2) {
      this.lastJankMarker = now
      this.mark('jank', String(Math.round(window.worstMs)), pkg)
    }
    push(this.frameHistory, stats)
    this.emit({ type: 'frames', serial: this.serial, stats })
  }

  private hwuiStats(pkg: string, t: number, w: FrameWindow): FrameStats {
    return { t, pkg, source: 'hwui', fps: w.fps, idle: w.idle, jankRatio: w.jankRatio, refreshHz: w.refreshHz, recent: w.recent, p50: w.p50, p90: w.p90, p99: w.p99, worstMs: w.worstMs }
  }

  /** timestats 是全局开关，用完就关，不给设备留下额外开销 */
  private async disableTimestats(): Promise<void> {
    if (!this.timestats) return
    this.timestats = false
    await this.adb.shell(this.serial, TIMESTATS_DISABLE, { timeout: COMMAND_TIMEOUT }).catch(() => undefined)
  }

  /* ---------------- 事件日志 ---------------- */

  private startEventLog(): void {
    if (!this.running || this.eventLog) return
    const child = this.adb.spawn(['-s', this.serial, ...EVENT_LOG_ARGS])
    this.eventLog = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) this.onLogLine(line)
    })
    child.stderr.resume()
    child.on('error', () => undefined)
    child.on('close', () => {
      if (this.eventLog !== child) return
      this.eventLog = undefined
      // 设备重启、adb 重连时 logcat 会退出，过一会儿重新接上
      if (this.running) this.eventLogTimer = setTimeout(() => this.startEventLog(), EVENT_LOG_RETRY)
    })
  }

  private onLogLine(line: string): void {
    const event = parseEventLog(line)
    if (!event) return
    const ofFocus = !!this.pkg && (event.name === this.pkg || event.name.startsWith(`${this.pkg}:`))
    switch (event.kind) {
      case 'crash':
      case 'anr':
      case 'lmk':
        this.mark(event.kind, event.name, event.detail)
        break
      case 'process':
        // 后台进程启动和回收非常频繁，只标关注应用的
        if (ofFocus) this.mark('process', event.name, event.detail, { action: event.action })
        break
    }
  }
}

function push<T>(list: T[], item: T): void {
  list.push(item)
  if (list.length > HISTORY_SIZE) list.shift()
}

/** com.foo.ui.MainActivity → MainActivity */
function shortActivity(activity: string): string {
  return activity.slice(activity.lastIndexOf('.') + 1)
}
