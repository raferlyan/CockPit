import type { BatteryState, LoadSample, MarkerKind, MetricsEvent, MetricsMarker, MetricsSnapshot, ProcessInfo, StorageMount } from '@shared/metrics'
import type { ControlInput } from '@shared/mirror'
import type { Device } from '@shared/models'
import type { AdbClient } from '../adb/AdbClient'
import { AppMonitor } from './AppMonitor'
import { AlertEngine } from './AlertEngine'
import type { AlertRules } from '@shared/alerts'
import {
  ACCELERATOR_COMMAND,
  cpuIowait,
  cpuUsage,
  loadCommand,
  parseAccelerators,
  parseBattery,
  parseCpuFreq,
  parseCpuLimits,
  parsePsi,
  parseThermalStatus,
  parseDf,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseConnectedIfaces,
  parseProcStat,
  parseThermal,
  parseTop,
  PROCESSES_COMMAND,
  SEP,
  STORAGE_COMMAND,
  type NetCounters
} from './parsers'

const LOAD_INTERVAL = 1_000
/** dumpsys battery 走 binder，比读节点重，每隔几次负载采集才带一次 */
const BATTERY_EVERY = 5
const PROCESSES_INTERVAL = 3_000
const STORAGE_INTERVAL = 10_000
/** 进程表最多带这么多行，界面上可以排序和搜索；toybox top 本身会列出全部进程 */
const PROCESS_LIMIT = 300
/** 环形缓冲长度：1s 一条，保留 30 分钟（曲线可以切换显示最近 5 / 10 / 30 分钟） */
const HISTORY_SIZE = 1800
const COMMAND_TIMEOUT = 5_000
const ACCELERATOR_INTERVAL = 2_000
/** root 会话可能被长命令占着；读数太旧就不要再画，曲线上留空比假装没变好 */
const ACCELERATOR_STALE = 6_000

/** 有后台 root 会话时用它执行（不写操作日志） */
export type RootExec = (serial: string) => ((command: string, timeout: number) => Promise<string>) | undefined

/** 单台设备的采集循环。上一轮还没返回时跳过本轮，避免命令在慢设备上堆积 */
class DevicePoller {
  readonly history: LoadSample[] = []
  processes?: ProcessInfo[]
  storage?: StorageMount[]
  error?: string

  private readonly timers: NodeJS.Timeout[] = []
  private readonly busy = new Set<string>()
  private readonly errors = new Map<string, string>()
  private tick = 0
  private prevStat?: ReturnType<typeof parseProcStat>
  private prevNet?: { counters: NetCounters; t: number }
  private battery?: BatteryState
  private thermalStatus?: number
  private accelerators?: { t: number; value: Pick<LoadSample, 'gpu' | 'npu'> }
  readonly app: AppMonitor
  readonly alerts = new AlertEngine()
  private readonly emit: (event: MetricsEvent) => void

  constructor(
    private readonly adb: AdbClient,
    readonly serial: string,
    emit: (event: MetricsEvent) => void,
    private readonly rootExec?: RootExec
  ) {
    // 所有推送都过一遍告警判定；告警本身以 alert 标记的形式再推出去
    this.emit = (event) => {
      emit(event)
      for (const firing of this.alerts.observe(event)) {
        this.app.mark('alert', firing.rule, firing.value, firing.resolved ? { resolved: true } : undefined)
      }
    }
    this.app = new AppMonitor(adb, serial, this.emit)
  }

  start(): void {
    const every = (name: string, interval: number, task: () => Promise<void>) => {
      const run = () => {
        if (this.busy.has(name)) return
        this.busy.add(name)
        task()
          .then(() => this.setError(name, undefined))
          .catch((error: Error) => this.setError(name, error.message))
          .finally(() => this.busy.delete(name))
      }
      run()
      this.timers.push(setInterval(run, interval))
    }
    every('load', LOAD_INTERVAL, () => this.collectLoad())
    every('accelerators', ACCELERATOR_INTERVAL, () => this.collectAccelerators())
    every('processes', PROCESSES_INTERVAL, () => this.collectProcesses())
    every('storage', STORAGE_INTERVAL, () => this.collectStorage())
    this.app.start(every)
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers.length = 0
    // 暂停后再恢复时重新取基线，避免把暂停期间平均成一个点
    this.prevStat = undefined
    this.prevNet = undefined
    this.app.stop()
  }

  snapshot(): MetricsSnapshot {
    return { serial: this.serial, history: [...this.history], processes: this.processes, storage: this.storage, error: this.error, ...this.app.snapshot() }
  }

  private async collectLoad(): Promise<void> {
    const withBattery = this.tick++ % BATTERY_EVERY === 0
    const out = await this.adb.shell(this.serial, loadCommand(withBattery, this.app.procCommand()), { timeout: COMMAND_TIMEOUT })
    const t = Date.now()
    const [
      statText = '',
      memText = '',
      freqText = '',
      thermalText = '',
      netText = '',
      loadText = '',
      addrText = '',
      batteryText = '',
      limitText = '',
      psiText = '',
      thermalStatusText = '',
      appStatText = '',
      appStatusText = ''
    ] = out.split(SEP)

    const stat = parseProcStat(statText)
    const prev = this.prevStat
    this.prevStat = stat
    this.app.onLoad(t, stat.all?.total, appStatText, appStatusText)
    const net = parseNetDev(netText)
    const prevNet = this.prevNet
    this.prevNet = net ? { counters: net, t } : undefined
    if (withBattery) {
      this.battery = parseBattery(batteryText) ?? this.battery
      this.thermalStatus = parseThermalStatus(thermalStatusText) ?? this.thermalStatus
    }

    const sample: LoadSample = {
      t,
      memory: parseMeminfo(memText),
      thermal: parseThermal(thermalText),
      battery: this.battery,
      loadavg: parseLoadavg(loadText),
      psi: parsePsi(psiText),
      thermalStatus: this.thermalStatus
    }
    if (this.accelerators && t - this.accelerators.t <= ACCELERATOR_STALE) Object.assign(sample, this.accelerators.value)
    // CPU 与网络是差值，第一轮只记基线
    const total = cpuUsage(prev?.all, stat.all)
    if (prev && total !== null) {
      const freqMHz = parseCpuFreq(freqText)
      const coreCount = Math.max(stat.cores.length, freqMHz.length)
      sample.cpu = {
        total,
        cores: Array.from({ length: coreCount }, (_, i) => cpuUsage(prev.cores[i], stat.cores[i])),
        freqMHz: Array.from({ length: coreCount }, (_, i) => freqMHz[i] ?? null),
        iowait: cpuIowait(prev.all, stat.all) ?? undefined,
        clusters: parseCpuLimits(limitText)
      }
    }
    if (net && prevNet && t > prevNet.t) {
      const seconds = (t - prevNet.t) / 1000
      const up = parseConnectedIfaces(addrText)
      const ifaces = [...net].map(([name, now]) => {
        const before = prevNet.counters.get(name)
        // 新出现的接口没有基线；接口重置时计数器会变小，速率记为 0
        return {
          name,
          up: up.has(name),
          rxBps: before ? Math.max(0, (now.rx - before.rx) / seconds) : 0,
          txBps: before ? Math.max(0, (now.tx - before.tx) / seconds) : 0
        }
      })
      sample.net = {
        rxBps: ifaces.reduce((sum, i) => sum + i.rxBps, 0),
        txBps: ifaces.reduce((sum, i) => sum + i.txBps, 0),
        // 只保留在线或有流量的接口，按流量排序
        ifaces: ifaces.filter((i) => i.up || i.rxBps + i.txBps > 0).sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))
      }
    }
    if (!sample.cpu && !prev) return

    this.history.push(sample)
    if (this.history.length > HISTORY_SIZE) this.history.shift()
    this.emit({ type: 'load', serial: this.serial, sample })
  }

  private async collectAccelerators(): Promise<void> {
    const exec = this.rootExec?.(this.serial)
    const out = exec
      ? await exec(ACCELERATOR_COMMAND, COMMAND_TIMEOUT)
      : await this.adb.shell(this.serial, ACCELERATOR_COMMAND, { timeout: COMMAND_TIMEOUT })
    this.accelerators = { t: Date.now(), value: parseAccelerators(out) }
  }

  private async collectProcesses(): Promise<void> {
    const out = await this.adb.shell(this.serial, PROCESSES_COMMAND, { timeout: COMMAND_TIMEOUT })
    this.processes = parseTop(out, PROCESS_LIMIT)
    this.emit({ type: 'processes', serial: this.serial, processes: this.processes })
  }

  private async collectStorage(): Promise<void> {
    const out = await this.adb.shell(this.serial, STORAGE_COMMAND, { timeout: COMMAND_TIMEOUT })
    this.storage = parseDf(out)
    this.emit({ type: 'storage', serial: this.serial, storage: this.storage })
  }

  /** 各采集任务的错误分开记录，任一任务失败都显示，全部恢复才清除 */
  private setError(task: string, message: string | undefined): void {
    if (message === undefined) this.errors.delete(task)
    else this.errors.set(task, message)
    const error = this.errors.values().next().value
    if (error === this.error) return
    this.error = error
    this.emit({ type: 'error', serial: this.serial, error: error ?? '' })
  }
}

/**
 * 对所有在线设备持续采集负载、进程与存储。
 * 设备数量按 2–3 台设计，全部常驻采集，切换焦点设备时历史曲线立即可用。
 */
export class MetricsService {
  private readonly pollers = new Map<string, DevicePoller>()
  /** 录制 trace 时暂停采集的设备，设备列表变化时也不重新启动 */
  private readonly paused = new Set<string>()
  private readonly framesWanted = new Set<string>()
  private alertRules?: AlertRules

  constructor(
    private readonly adb: AdbClient,
    private readonly emit: (event: MetricsEvent) => void,
    private readonly rootExec?: RootExec
  ) {}

  onDevicesChanged(devices: Device[]): void {
    const online = new Set(devices.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const [serial, poller] of this.pollers) {
      if (!online.has(serial)) {
        poller.stop()
        this.pollers.delete(serial)
      }
    }
    for (const serial of online) {
      if (this.pollers.has(serial) || this.paused.has(serial)) continue
      const poller = new DevicePoller(this.adb, serial, this.emit, this.rootExec)
      this.pollers.set(serial, poller)
      if (this.framesWanted.has(serial)) poller.app.setFramesWanted(true)
      if (this.alertRules) poller.alerts.setRules(this.alertRules)
      poller.start()
    }
  }

  snapshot(serial: string): MetricsSnapshot {
    return this.pollers.get(serial)?.snapshot() ?? { serial, history: [] }
  }

  /** 固定关注某个应用；传 undefined 恢复跟随前台 */
  setFocusApp(serial: string, pkg: string | undefined): void {
    this.require(serial).app.setPinned(pkg)
  }

  /** 界面上有人在看帧率时才采；记下来，设备重连、新建采集循环后照样生效 */
  setFramesWanted(serial: string, wanted: boolean): void {
    if (wanted) this.framesWanted.add(serial)
    else this.framesWanted.delete(serial)
    this.pollers.get(serial)?.app.setFramesWanted(wanted)
  }

  /** 告警规则由界面的设置决定，对所有设备生效 */
  setAlertRules(rules: AlertRules): void {
    this.alertRules = rules
    for (const poller of this.pollers.values()) poller.alerts.setRules(rules)
  }

  noteInput(serial: string, input: ControlInput): void {
    this.pollers.get(serial)?.app.noteInput(input)
  }

  mark(serial: string, kind: MarkerKind, label: string, detail?: string): MetricsMarker | undefined {
    return this.pollers.get(serial)?.app.mark(kind, label, detail)
  }

  private require(serial: string): DevicePoller {
    const poller = this.pollers.get(serial)
    if (!poller) throw new Error('设备不在线或采集已暂停')
    return poller
  }

  /** 暂停时停掉定时采集但保留历史曲线，恢复后接着画 */
  setPaused(serial: string, paused: boolean): void {
    if (paused) this.paused.add(serial)
    else this.paused.delete(serial)
    const poller = this.pollers.get(serial)
    if (!poller) return
    if (paused) poller.stop()
    else poller.start()
  }

  dispose(): void {
    for (const poller of this.pollers.values()) poller.stop()
    this.pollers.clear()
  }
}
