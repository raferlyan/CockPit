import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TRACE_MAX_DURATION_SEC, TRACE_PRESETS, type TraceRecordEvent, type TraceRecordOptions, type TraceWindow } from '@shared/trace'
import type { Device } from '@shared/models'
import type { AdbClient } from '../adb/AdbClient'
import type { TraceLibrary } from './TraceLibrary'
import { buildTraceConfig, isPackageName, MIN_SDK, TRACED_DEFAULT_SDK } from './traceConfig'

const REMOTE_CONFIG = '/data/local/tmp/cockpit-trace.pbtxt'
const REMOTE_DIR = '/data/misc/perfetto-traces'
/** 超过设定时长这么久还没结束，认为 perfetto 卡住 */
const EXIT_GRACE = 30_000
/** 启动分析：perfetto 连上 traced 后再等一会儿，等各数据源开始采集再拉起应用 */
const LAUNCH_DELAY = 1_500
const PULL_TIMEOUT = 10 * 60_000

interface Recording {
  event: TraceRecordEvent
  child?: ChildProcessWithoutNullStreams
  pid?: number
  remotePath: string
  localPath: string
  stderr: string
  exitCode?: number
  /** 设备 /proc/uptime 读数（秒），用来算实际录制的时间段 */
  bootStart?: string
  bootEnd?: string
  watchdog?: NodeJS.Timeout
  stopRequested: boolean
  resumeMetrics: boolean
}

/**
 * 用设备自带的 perfetto 录制系统 trace，结束后拉回本机。
 *
 * 配置先 push 到 /data/local/tmp，再在设备上用 `cat | perfetto -c -` 管道传入：
 * Android 12 起 SELinux 不允许 perfetto 直接读 /data/local/tmp 下的文件，管道则不受限。
 * perfetto 放到后台并打印 pid，提前结束时对它发 SIGTERM，它会正常收尾写完文件。
 */
export class TraceRecorder {
  private readonly recordings = new Map<string, Recording>()

  constructor(
    private readonly adb: AdbClient,
    private readonly library: TraceLibrary,
    private readonly device: (serial: string) => Device | undefined,
    private readonly setMetricsPaused: (serial: string, paused: boolean) => void,
    private readonly emit: (event: TraceRecordEvent) => void
  ) {}

  /** 正在进行的录制，界面重新打开时用来恢复进度 */
  list(): TraceRecordEvent[] {
    return [...this.recordings.values()].map((r) => r.event)
  }

  async start(serial: string, options: TraceRecordOptions, label: string): Promise<void> {
    if (this.recordings.has(serial)) throw new Error('这台设备正在录制 trace')
    const device = this.device(serial)
    if (device?.state !== 'device') throw new Error('设备不在线')
    const sdk = device.info?.sdk
    if (!sdk) throw new Error('还没读到设备的 Android 版本，稍后再试')
    if (sdk < MIN_SDK) throw new Error(`录制需要 Android 10 及以上，这台设备是 API ${sdk}`)
    const preset = TRACE_PRESETS.find((p) => p.id === options.preset)
    if (!preset) throw new Error(`未知的录制类型：${options.preset}`)
    const durationSec = Math.round(options.durationSec)
    if (!(durationSec >= 1 && durationSec <= TRACE_MAX_DURATION_SEC)) throw new Error(`录制时长需要在 1–${TRACE_MAX_DURATION_SEC} 秒之间`)
    const app = options.app?.trim() || undefined
    if (app && !isPackageName(app)) throw new Error(`包名格式不对：${app}`)
    if (preset.app === 'required' && !app) throw new Error(`「${preset.label}」需要选择一个应用`)

    const name = this.library.fileName(label, preset.id)
    const rec: Recording = {
      event: { serial, state: 'starting', preset: preset.id, durationMs: durationSec * 1000 },
      remotePath: `${REMOTE_DIR}/cockpit-${Date.now()}.pftrace`,
      localPath: join(await this.library.ensureDir(), name),
      stderr: '',
      stopRequested: false,
      resumeMetrics: options.pauseMetrics
    }
    this.recordings.set(serial, rec)
    this.update(rec, {})

    try {
      if (options.pauseMetrics) this.setMetricsPaused(serial, true)
      if (sdk < TRACED_DEFAULT_SDK) {
        // Android 10 上 traced 默认关闭，打开后服务需要一点时间起来
        const enabled = (await this.adb.shell(serial, 'getprop persist.traced.enable')).trim() === '1'
        if (!enabled) {
          await this.adb.shell(serial, 'setprop persist.traced.enable 1')
          await delay(1_000)
        }
      }
      const config = buildTraceConfig({ ...options, durationSec, app }, sdk)
      const localConfig = join(tmpdir(), `cockpit-trace-${process.pid}-${Date.now()}.pbtxt`)
      await writeFile(localConfig, config)
      try {
        await this.adb.push(serial, localConfig, REMOTE_CONFIG)
      } finally {
        void rm(localConfig, { force: true })
      }
      if (this.recordings.get(serial) !== rec) return
      this.spawn(rec, preset.id === 'startup' ? app : undefined)
    } catch (error) {
      this.fail(rec, (error as Error).message)
    }
  }

  /** 提前结束录制，已录到的部分照常保存 */
  async stop(serial: string): Promise<void> {
    const rec = this.recordings.get(serial)
    if (!rec || rec.stopRequested) return
    rec.stopRequested = true
    if (rec.event.state === 'starting' && !rec.child) {
      this.fail(rec, '已取消')
      return
    }
    if (rec.event.state !== 'recording' || rec.pid === undefined) return
    this.update(rec, { state: 'stopping' })
    try {
      await this.adb.shell(serial, `kill -TERM ${rec.pid}`)
    } catch (error) {
      // 进程可能刚好自己结束了；真卡住时由看门狗收尾
      console.warn('[trace] stop failed', error)
    }
  }

  onDevicesChanged(devices: Device[]): void {
    for (const [serial, rec] of this.recordings) {
      if (!devices.some((d) => d.serial === serial && d.state === 'device')) rec.child?.kill()
    }
  }

  dispose(): void {
    for (const [serial, rec] of this.recordings) {
      // 退出时尽量让设备上的 perfetto 也停下，不等结果
      if (rec.pid !== undefined) void this.adb.shell(serial, `kill -TERM ${rec.pid}`, { timeout: 2_000 }).catch(() => undefined)
      rec.child?.kill()
      if (rec.resumeMetrics) this.setMetricsPaused(serial, false)
    }
    this.recordings.clear()
  }

  private spawn(rec: Recording, launchApp: string | undefined): void {
    const { serial } = rec.event
    // $! 是后台管道最后一个命令（perfetto）的 pid；wait 拿到它的退出码。
    // 前后各读一次 /proc/uptime（即 CLOCK_BOOTTIME，与 trace 时间戳同一个时钟）记下实际录制的时间段
    const command =
      `cat ${REMOTE_CONFIG} | perfetto --txt -c - -o ${rec.remotePath} & echo COCKPIT_PID=$! COCKPIT_BOOT=$(cat /proc/uptime); ` +
      'wait $!; echo COCKPIT_EXIT=$? COCKPIT_END=$(cat /proc/uptime)'
    const child = spawn(this.adb.adbPath, ['-s', serial, 'shell', command], { windowsHide: true })
    rec.child = child
    let stdout = ''
    let launched = false

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const pid = /COCKPIT_PID=(\d+)/.exec(stdout)
      if (pid && rec.pid === undefined) {
        rec.pid = Number(pid[1])
        this.update(rec, { state: 'recording', startedAt: Date.now() })
        rec.watchdog = setTimeout(() => child.kill(), rec.event.durationMs + EXIT_GRACE)
        // 用户在 pid 出来之前就点了结束
        if (rec.stopRequested) {
          rec.stopRequested = false
          void this.stop(serial)
        }
      }
      rec.bootStart ??= /COCKPIT_BOOT=([\d.]+)/.exec(stdout)?.[1]
      const exit = /COCKPIT_EXIT=(\d+)/.exec(stdout)
      if (exit) rec.exitCode = Number(exit[1])
      rec.bootEnd ??= /COCKPIT_END=([\d.]+)/.exec(stdout)?.[1]
    })
    child.stderr.on('data', (chunk: Buffer) => {
      rec.stderr = (rec.stderr + chunk.toString()).slice(-4_000)
      if (launchApp && !launched && rec.stderr.includes('Connected to the Perfetto traced service')) {
        launched = true
        setTimeout(() => void this.launch(rec, launchApp), LAUNCH_DELAY)
      }
    })
    child.on('error', (error) => this.fail(rec, error.message))
    child.on('close', () => {
      clearTimeout(rec.watchdog)
      if (this.recordings.get(serial) !== rec) return
      if (rec.exitCode === 0) void this.pull(rec)
      else this.fail(rec, perfettoError(rec.stderr) ?? (rec.exitCode === undefined ? '录制进程意外结束（设备可能已断开）' : `perfetto 退出码 ${rec.exitCode}`))
    })
  }

  /** 冷启动：先强制停止，再通过桌面入口拉起，am start -W 等到首帧绘制完成 */
  private async launch(rec: Recording, app: string): Promise<void> {
    if (rec.event.state !== 'recording') return
    const { serial } = rec.event
    try {
      await this.adb.shell(serial, `am force-stop ${app}`)
      const out = await this.adb.shell(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${app} | tail -n 1`)
      const component = out.trim()
      if (!component.includes('/')) throw new Error(`${app} 没有桌面入口，无法自动启动`)
      const result = await this.adb.shell(serial, `am start -W -n ${component}`, { timeout: 30_000 })
      const total = /TotalTime:\s*(\d+)/.exec(result)?.[1]
      if (total) this.update(rec, { message: `已冷启动 ${app}，am start 报告 TotalTime ${total} ms` })
    } catch (error) {
      this.update(rec, { message: `自动启动应用失败：${(error as Error).message}` })
    }
  }

  private async pull(rec: Recording): Promise<void> {
    const { serial } = rec.event
    this.update(rec, { state: 'pulling' })
    try {
      await this.adb.exec(['-s', serial, 'pull', rec.remotePath, rec.localPath], { timeout: PULL_TIMEOUT })
      const info = await stat(rec.localPath)
      this.finish(rec, {
        state: 'done',
        file: { path: rec.localPath, name: rec.localPath.split(/[\\/]/).pop() ?? '', size: info.size, mtime: info.mtimeMs },
        window: recordedWindow(rec.bootStart, rec.bootEnd)
      })
    } catch (error) {
      void rm(rec.localPath, { force: true })
      this.fail(rec, `拉取 trace 失败：${(error as Error).message}`)
    }
  }

  private fail(rec: Recording, message: string): void {
    rec.child?.kill()
    this.finish(rec, { state: 'error', message })
  }

  private finish(rec: Recording, patch: Partial<TraceRecordEvent>): void {
    const { serial } = rec.event
    if (this.recordings.get(serial) !== rec) return
    clearTimeout(rec.watchdog)
    this.recordings.delete(serial)
    if (rec.resumeMetrics) this.setMetricsPaused(serial, false)
    this.update(rec, patch)
    // 设备上只是临时文件，成功失败都清掉
    void this.adb.shell(serial, `rm -f ${rec.remotePath} ${REMOTE_CONFIG}`).catch(() => undefined)
  }

  private update(rec: Recording, patch: Partial<TraceRecordEvent>): void {
    rec.event = { ...rec.event, ...patch }
    this.emit(rec.event)
  }
}

/** 从 perfetto 的输出里挑出真正的错误信息，例如配置解析失败或 traced 未运行 */
export function perfettoError(stderr: string): string | undefined {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const parse = lines.find((l) => / error: /.test(l))
  if (parse) return `配置无效：${parse.replace(/^-:\d+:\d+ error: /, '')}`
  if (lines.some((l) => /Could not connect to the traced/i.test(l))) return '连接不上 traced 服务。Android 10 需要 setprop persist.traced.enable 1 后重启 traced'
  const err = lines.reverse().find((l) => /perfetto_cmd|traced|error|failed/i.test(l) && !/Connected to the Perfetto/.test(l))
  return err?.replace(/^\[[\d.]+\]\s*\S+\s+/, '')
}

/**
 * Perfetto 只接受完全落在 trace 范围内的时间段，否则忽略。开始读数比第一个事件早（实测约 0.2 秒），
 * 结束读数在 perfetto 写完文件之后、比最后一个事件晚，两头各往里让 0.5 秒
 */
const EDGE_MARGIN_NS = 500_000_000n

/** 把前后两次 /proc/uptime 读数（秒，两位小数）换算成 trace 时间轴上的纳秒区间 */
export function recordedWindow(bootStart: string | undefined, bootEnd: string | undefined): TraceWindow | undefined {
  const ns = (seconds: string | undefined) => {
    const m = seconds && /^(\d+)(?:\.(\d{1,9}))?$/.exec(seconds)
    return m ? BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0')) : undefined
  }
  const start = ns(bootStart)
  const end = ns(bootEnd)
  if (start === undefined || end === undefined) return undefined
  const visibleStart = start + EDGE_MARGIN_NS
  const visibleEnd = end - EDGE_MARGIN_NS
  return visibleEnd > visibleStart ? { start: visibleStart.toString(), end: visibleEnd.toString() } : undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
