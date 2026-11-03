import type { BatteryState, LoadSample, MetricsEvent, MetricsSnapshot, ProcessInfo, StorageMount } from '@shared/metrics'
import type { Device } from '@shared/models'
import type { AdbClient } from '../adb/AdbClient'
import {
  cpuUsage,
  loadCommand,
  parseBattery,
  parseCpuFreq,
  parseDf,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseOperstate,
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
/** 环形缓冲长度：1s 一条，保留 5 分钟，正好是曲线显示的范围 */
const HISTORY_SIZE = 300
const COMMAND_TIMEOUT = 5_000

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

  constructor(
    private readonly adb: AdbClient,
    readonly serial: string,
    private readonly emit: (event: MetricsEvent) => void
  ) {}

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
    every('processes', PROCESSES_INTERVAL, () => this.collectProcesses())
    every('storage', STORAGE_INTERVAL, () => this.collectStorage())
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers.length = 0
  }

  snapshot(): MetricsSnapshot {
    return { serial: this.serial, history: [...this.history], processes: this.processes, storage: this.storage, error: this.error }
  }

  private async collectLoad(): Promise<void> {
    const withBattery = this.tick++ % BATTERY_EVERY === 0
    const out = await this.adb.shell(this.serial, loadCommand(withBattery), { timeout: COMMAND_TIMEOUT })
    const t = Date.now()
    const [statText = '', memText = '', freqText = '', thermalText = '', netText = '', loadText = '', operText = '', batteryText = ''] = out.split(SEP)

    const stat = parseProcStat(statText)
    const prev = this.prevStat
    this.prevStat = stat
    const net = parseNetDev(netText)
    const prevNet = this.prevNet
    this.prevNet = net ? { counters: net, t } : undefined
    if (withBattery) this.battery = parseBattery(batteryText) ?? this.battery

    const sample: LoadSample = {
      t,
      memory: parseMeminfo(memText),
      thermal: parseThermal(thermalText),
      battery: this.battery,
      loadavg: parseLoadavg(loadText)
    }
    // CPU 与网络是差值，第一轮只记基线
    const total = cpuUsage(prev?.all, stat.all)
    if (prev && total !== null) {
      const freqMHz = parseCpuFreq(freqText)
      const coreCount = Math.max(stat.cores.length, freqMHz.length)
      sample.cpu = {
        total,
        cores: Array.from({ length: coreCount }, (_, i) => cpuUsage(prev.cores[i], stat.cores[i])),
        freqMHz: Array.from({ length: coreCount }, (_, i) => freqMHz[i] ?? null)
      }
    }
    if (net && prevNet && t > prevNet.t) {
      const seconds = (t - prevNet.t) / 1000
      const up = parseOperstate(operText)
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

  private async collectProcesses(): Promise<void> {
    const out = await this.adb.shell(this.serial, PROCESSES_COMMAND, { timeout: COMMAND_TIMEOUT })
    this.processes = parseTop(out)
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

  constructor(
    private readonly adb: AdbClient,
    private readonly emit: (event: MetricsEvent) => void
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
      if (this.pollers.has(serial)) continue
      const poller = new DevicePoller(this.adb, serial, this.emit)
      this.pollers.set(serial, poller)
      poller.start()
    }
  }

  snapshot(serial: string): MetricsSnapshot {
    return this.pollers.get(serial)?.snapshot() ?? { serial, history: [] }
  }

  dispose(): void {
    for (const poller of this.pollers.values()) poller.stop()
    this.pollers.clear()
  }
}
