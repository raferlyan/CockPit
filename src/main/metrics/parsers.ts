import type { BatteryState, BatteryStatus, LoadSample, ProcessInfo, StorageMount } from '@shared/metrics'

export const SEP = '__COCKPIT_SEP__'

/**
 * 负载采集合并成一次 shell 调用，各段用分隔符切开。
 * 段顺序：/proc/stat、meminfo、每核频率、温度、网络、loadavg、（可选）dumpsys battery。
 */
export function loadCommand(withBattery: boolean): string {
  const parts = [
    'cat /proc/stat',
    'cat /proc/meminfo',
    // 逐核输出“cpuN 频率”，离线核没有 cpufreq 节点时频率为空
    'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "${c##*/} $(cat $c/cpufreq/scaling_cur_freq 2>/dev/null)"; done',
    'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null) $(cat $z/temp 2>/dev/null)"; done',
    'cat /proc/net/dev',
    'cat /proc/loadavg',
    // /sys/class/net/*/operstate 在 Android 12+ 上 shell 读不到（SELinux），改看哪些接口拿到了全局地址
    'ip -o addr show 2>/dev/null',
    withBattery ? 'dumpsys battery' : 'true'
  ]
  return parts.join(`; echo ${SEP}; `) + '; exit 0'
}

export const PROCESSES_COMMAND = 'top -b -n 1 -q -s 3 -o PID,USER,%CPU,RES,NAME'
export const STORAGE_COMMAND = 'df -k /data /storage/emulated/0 / 2>/dev/null; exit 0'

/** /proc/stat 中一行 cpu 的累计时间 */
export interface CpuTimes {
  busy: number
  total: number
}

/** 返回 [总体, cpu0, cpu1, …]；离线核在 /proc/stat 中不出现，对应位置为 undefined */
export function parseProcStat(text: string): { all?: CpuTimes; cores: (CpuTimes | undefined)[] } {
  const cores: (CpuTimes | undefined)[] = []
  let all: CpuTimes | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^cpu(\d*)\s+(.+)$/)
    if (!match) continue
    const values = match[2].trim().split(/\s+/).map(Number)
    // user nice system idle iowait irq softirq steal …；idle + iowait 视为空闲
    const total = values.slice(0, 8).reduce((a, b) => a + (b || 0), 0)
    const idle = (values[3] || 0) + (values[4] || 0)
    const times = { busy: total - idle, total }
    if (match[1] === '') all = times
    else cores[Number(match[1])] = times
  }
  return { all, cores }
}

/** 两次采样的占用百分比；没有前一次或时间未前进时返回 null */
export function cpuUsage(prev: CpuTimes | undefined, next: CpuTimes | undefined): number | null {
  if (!prev || !next) return null
  const total = next.total - prev.total
  if (total <= 0) return null
  return clamp(((next.busy - prev.busy) / total) * 100, 0, 100)
}

export function parseMeminfo(text: string): LoadSample['memory'] {
  const values = new Map<string, number>()
  for (const match of text.matchAll(/^(\w+):\s+(\d+)\s*kB/gm)) values.set(match[1], Number(match[2]))
  const totalKB = values.get('MemTotal')
  if (!totalKB) return undefined
  // 老内核没有 MemAvailable，用 Free + Cached 近似
  const availableKB = values.get('MemAvailable') ?? (values.get('MemFree') ?? 0) + (values.get('Cached') ?? 0)
  return { totalKB, availableKB, swapTotalKB: values.get('SwapTotal') ?? 0, swapFreeKB: values.get('SwapFree') ?? 0 }
}

/** “cpu0 1785600” → 下标 0 为 1785.6 MHz */
export function parseCpuFreq(text: string): (number | null)[] {
  const freqs: (number | null)[] = []
  for (const match of text.matchAll(/^cpu(\d+)[ \t]*(\d*)\s*$/gm)) {
    freqs[Number(match[1])] = match[2] ? Math.round(Number(match[2]) / 1000) : null
  }
  return Array.from(freqs, (f) => f ?? null)
}

/**
 * 传感器命名按厂商差异很大，这里按类型名归类，同类取最大值。
 * 没列进来的传感器（PMIC、电压、电量等）不参与，避免把电压当成温度。
 */
const THERMAL_GROUPS: [keyof NonNullable<LoadSample['thermal']>, RegExp][] = [
  ['gpu', /gpu/i],
  ['cpu', /^(cpu|cpuss|apc\d|mtktscpu|soc_thermal|tsens_tz_sensor|cpu_therm|little|big|mid)/i],
  ['battery', /^(battery|bms|battery_therm|mtktsbattery)$/i],
  ['skin', /(skin|xo[-_]therm|quiet[-_]therm|shell|board[-_]therm|mtktsap)/i]
]

export function parseThermal(text: string): LoadSample['thermal'] {
  const result: NonNullable<LoadSample['thermal']> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(-?\d+)$/)
    if (!match) continue
    const celsius = toCelsius(Number(match[2]))
    if (celsius === undefined) continue
    const group = THERMAL_GROUPS.find(([, pattern]) => pattern.test(match[1]))?.[0]
    if (group) result[group] = Math.max(result[group] ?? -Infinity, celsius)
  }
  return Object.keys(result).length ? result : undefined
}

/** 大多数节点单位是毫摄氏度，少数直接是摄氏度；超出合理范围的读数丢弃 */
function toCelsius(raw: number): number | undefined {
  const celsius = Math.abs(raw) >= 1000 ? raw / 1000 : raw
  if (celsius <= -20 || celsius >= 150) return undefined
  return Math.round(celsius * 10) / 10
}

/** 每块网卡的累计收发字节 */
export type NetCounters = Map<string, { rx: number; tx: number }>

/**
 * 不计入吞吐的虚拟接口：回环、隧道、VPN、IPA 硬件加速通道等。
 * 它们的流量要么不出设备，要么与真实网卡重复计数（如 rmnet_ipa0 与 rmnet_data*、tun0 与 wlan0）。
 */
const VIRTUAL_IFACE = /^(lo|dummy|ifb|tun|tap|sit|ip6tnl|ip_vti|ip6_vti|ip6gre|gre|gretap|erspan|tunl|rmnet_ipa|r_rmnet|veth|clat|v4-)/

export function isPhysicalIface(name: string): boolean {
  return !VIRTUAL_IFACE.test(name)
}

export function parseNetDev(text: string): NetCounters | undefined {
  const counters: NetCounters = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^\s:]+):\s*(.+)$/)
    if (!match || !isPhysicalIface(match[1])) continue
    const values = match[2].trim().split(/\s+/).map(Number)
    if (values.length < 9) continue
    counters.set(match[1], { rx: values[0] || 0, tx: values[8] || 0 })
  }
  return counters.size ? counters : undefined
}

/**
 * 从 `ip -o addr show` 找出已联网的接口：拿到 scope global 地址（IPv4 或 IPv6）的视为在线。
 * 行形如 `30: wlan0    inet 192.168.10.200/24 brd … scope global wlan0\ …`。
 */
export function parseConnectedIfaces(text: string): Set<string> {
  const up = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\d+:\s+([^\s@:]+)\s+inet6?\s.*\bscope global\b/)
    if (match) up.add(match[1])
  }
  return up
}

export function parseLoadavg(text: string): [number, number, number] | undefined {
  const match = text.trim().match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

const BATTERY_STATUS: Record<string, BatteryStatus> = {
  '2': 'charging',
  '3': 'discharging',
  '4': 'not-charging',
  '5': 'full'
}

/** 只解析标准的 “Current Battery Service state:” 段，跳过厂商自定义段（如 OPLUS） */
export function parseBattery(text: string): BatteryState | undefined {
  const start = text.indexOf('Current Battery Service state:')
  if (start < 0) return undefined
  const section = text.slice(start)
  const field = (name: string) => section.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm'))?.[1]
  const level = Number(field('level'))
  const scale = Number(field('scale')) || 100
  if (!Number.isFinite(level)) return undefined
  return {
    level: Math.round((level / scale) * 100),
    temperature: (Number(field('temperature')) || 0) / 10,
    voltage: Number(field('voltage')) || 0,
    status: BATTERY_STATUS[field('status') ?? ''] ?? 'unknown',
    power: ['AC', 'USB', 'Wireless', 'Dock'].filter((source) => field(`${source} powered`) === 'true')
  }
}

/** toybox top 的 RES 列：0、120K、4.9M、1.2G */
function parseSizeKB(text: string): number {
  const match = text.match(/^([\d.]+)([KMGT]?)$/i)
  if (!match) return 0
  const scale = { '': 1 / 1024, K: 1, M: 1024, G: 1024 ** 2, T: 1024 ** 3 }[match[2].toUpperCase()] ?? 1
  return Math.round(Number(match[1]) * scale)
}

export function parseTop(text: string, limit = 10): ProcessInfo[] {
  const list: ProcessInfo[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    list.push({ pid: Number(match[1]), user: match[2], cpu: Number(match[3]), resKB: parseSizeKB(match[4]), name: match[5].trim() })
  }
  // 排除 top 自身
  return list
    .filter((p) => p.name !== 'top')
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, limit)
}

/**
 * 同一分区可能以多个路径出现（/data/user/0、/storage/emulated 都在 data 分区上），
 * 按容量与已用去重，保留先出现的那个。
 */
export function parseDf(text: string): StorageMount[] {
  const seen = new Set<string>()
  const mounts: StorageMount[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\S+)$/)
    if (!match) continue
    const [sizeKB, usedKB, availKB] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const mount = normalizeMount(match[4])
    const key = `${sizeKB}:${usedKB}`
    if (seen.has(key) || seen.has(mount)) continue
    seen.add(key).add(mount)
    mounts.push({ mount, sizeKB, usedKB, availKB })
  }
  return mounts
}

/** /data/user/0 实际就是 /data 分区；/storage/emulated 为内部共享存储 */
function normalizeMount(mount: string): string {
  if (mount.startsWith('/data')) return '/data'
  if (mount.startsWith('/storage/emulated')) return '/sdcard'
  return mount
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
