import type { ForegroundApp, MarkerKind, ThreadInfo } from '@shared/metrics'
import { isPackageName } from '../trace/traceConfig'
import { SEP } from './parsers'

/* ---------------- 前台应用与关注应用的进程 ---------------- */

/**
 * 前台 Activity，以及关注应用的全部进程（含 :push 这类子进程）。
 * 多屏或分屏时会有多行 topResumedActivity，第一行是最上层的。
 * pkg 在设备端拼进 grep，先校验格式防注入。
 */
export function foregroundCommand(pkg: string | undefined): string {
  const parts = ["dumpsys activity activities 2>/dev/null | grep -m 3 -E 'topResumedActivity=|ResumedActivity:'"]
  if (pkg && isPackageName(pkg)) parts.push(`ps -A -o PID,NAME | grep -F ${pkg}`)
  return parts.join(`; echo ${SEP}; `) + '; exit 0'
}

export function parseForeground(text: string): ForegroundApp | undefined {
  const match = text.match(/ActivityRecord\{\S+ u\d+ ([\w.]+)\/([\w.$]+)/)
  if (!match) return undefined
  const [, pkg, cls] = match
  return { pkg, activity: cls.startsWith('.') ? pkg + cls : cls }
}

/** `ps -A -o PID,NAME` 的行里取出包名本身和它的子进程（pkg:xxx） */
export function parsePids(text: string, pkg: string): number[] {
  const pids: number[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)$/)
    if (match && (match[2] === pkg || match[2].startsWith(`${pkg}:`))) pids.push(Number(match[1]))
  }
  return pids.sort((a, b) => a - b)
}

/* ---------------- 关注应用的 CPU / 内存 / 线程 ---------------- */

/**
 * 拼进每秒那一条负载命令里的两段：一次 cat 读所有 pid 的 stat，一次 grep 读 RSS 和线程数。
 * pid 来自 parsePids，只会是数字。
 */
export function appProcCommand(pids: number[]): [string, string] {
  if (!pids.length) return ['true', 'true']
  const stat = pids.map((p) => `/proc/${p}/stat`).join(' ')
  const status = pids.map((p) => `/proc/${p}/status`).join(' ')
  return [`cat ${stat} 2>/dev/null`, `grep -H -E '^(VmRSS|Threads):' ${status} 2>/dev/null`]
}

export interface ProcTimes {
  /** utime + stime，单位 clock tick（与 /proc/stat 相同） */
  ticks: number
  rssKB?: number
  threads?: number
}

export function parseAppProc(statText: string, statusText: string): Map<number, ProcTimes> {
  const result = new Map<number, ProcTimes>()
  for (const line of statText.split(/\r?\n/)) {
    // 进程名在括号里，可能带空格和括号，从最后一个 ')' 之后开始数字段
    const close = line.lastIndexOf(')')
    const pid = Number(line.slice(0, line.indexOf(' ')))
    if (close < 0 || !Number.isInteger(pid) || pid <= 0) continue
    const fields = line.slice(close + 2).split(' ')
    const utime = Number(fields[11])
    const stime = Number(fields[12])
    if (Number.isFinite(utime) && Number.isFinite(stime)) result.set(pid, { ticks: utime + stime })
  }
  for (const match of statusText.matchAll(/\/proc\/(\d+)\/status:(VmRSS|Threads):\s+(\d+)/g)) {
    const entry = result.get(Number(match[1]))
    if (!entry) continue
    if (match[2] === 'VmRSS') entry.rssKB = Number(match[3])
    else entry.threads = Number(match[3])
  }
  return result
}

export function meminfoCommand(pkg: string): string | undefined {
  if (!isPackageName(pkg)) return undefined
  return `dumpsys meminfo ${pkg} 2>/dev/null | grep -m 1 -E 'TOTAL PSS:|^ *TOTAL '; exit 0`
}

/** Android 11+ 有 `TOTAL PSS:  43947`，更早的版本是表格里 `TOTAL  43947 …` 的第一列 */
export function parseMeminfoPss(text: string): number | undefined {
  const match = text.match(/TOTAL PSS:\s+(\d+)/) ?? text.match(/^\s*TOTAL\s+(\d+)/m)
  return match ? Number(match[1]) : undefined
}

export function threadsCommand(pids: number[], limit = 8): string {
  return `top -H -b -n 1 -q -p ${pids.join(',')} -o TID,%CPU,CMD -s 2 | head -n ${limit}; exit 0`
}

export function parseThreads(text: string): ThreadInfo[] {
  const threads: ThreadInfo[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(.+?)\s*$/)
    if (match) threads.push({ tid: Number(match[1]), cpu: Number(match[2]), name: match[3] })
  }
  return threads
}

/* ---------------- 帧统计 ---------------- */

/** 只要 framestats 的 CSV（表头和数据行），省掉每次三四十 KB 的直方图和内存信息 */
export function framesCommand(pkg: string): string | undefined {
  if (!isPackageName(pkg)) return undefined
  return `dumpsys gfxinfo ${pkg} framestats 2>/dev/null | grep -E '^(Flags|[0-9]+,)'; exit 0`
}

export interface FrameRow {
  /** 纳秒，CLOCK_MONOTONIC */
  intended: number
  completed: number
  /** Android 12+ 才有 */
  deadline?: number
  /** 刷新间隔，纳秒；Android 12+ 才有 */
  interval?: number
}

/**
 * 解析 framestats 的 CSV。多个窗口各有一段，表头可能重复出现，按最近的表头取列。
 * Flags 非 0 的帧（窗口首帧、尺寸变化等）与 JankTracker 一样跳过。
 * 实测 Android 14 的表头把 FrameInterval 写在 FrameStartTime 前面，数据却是反的，
 * 所以这两列里取看起来像刷新间隔（1–100 ms）的那个值。
 */
export function parseFramestats(text: string): FrameRow[] {
  const rows: FrameRow[] = []
  let col: Record<string, number> | undefined
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('Flags,')) {
      col = Object.fromEntries(line.split(',').map((name, i) => [name, i]))
      continue
    }
    if (!col || !/^\d/.test(line)) continue
    const values = line.split(',').map(Number)
    if (values[col.Flags] !== 0) continue
    const intended = values[col.IntendedVsync]
    const completed = values[col.FrameCompleted]
    if (!(intended > 0) || !(completed > intended)) continue
    const row: FrameRow = { intended, completed }
    const deadline = values[col.FrameDeadline]
    if (deadline > intended) row.deadline = deadline
    const interval = [col.FrameInterval, col.FrameStartTime].map((i) => values[i]).find((v) => v >= 1e6 && v <= 1e8)
    if (interval) row.interval = interval
    rows.push(row)
  }
  return rows
}

export const TIMESTATS_ENABLE = 'dumpsys SurfaceFlinger --timestats -enable -clear'
export const TIMESTATS_DISABLE = 'dumpsys SurfaceFlinger --timestats -disable'
/** 读完即清零，每次拿到的就是两次调用之间的增量 */
export const TIMESTATS_DUMP =
  "dumpsys SurfaceFlinger --timestats -dump -clear 2>/dev/null | grep -E '^(layerName|totalFrames|totalTimelineFrames|jankyFrames|displayRefreshRate) ='; exit 0"

export interface LayerStats {
  frames: number
  timelineFrames: number
  janky: number
  refreshHz?: number
}

/**
 * 汇总名字里带包名的图层（Activity 窗口和 SurfaceView[包名/…] 都算）。
 * 输出里图层之前还有一段全局统计，用 layerName 出现与否区分。
 */
export function parseTimestats(text: string, pkg: string): LayerStats | undefined {
  let current: string | undefined
  let refreshHz: number | undefined
  const total: LayerStats = { frames: 0, timelineFrames: 0, janky: 0 }
  let matched = false
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\w+) = (.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (key === 'displayRefreshRate') refreshHz = parseFloat(value) || refreshHz
    else if (key === 'layerName') {
      current = value
      if (current.includes(pkg)) matched = true
    } else if (current?.includes(pkg)) {
      const n = Number(value) || 0
      if (key === 'totalFrames') total.frames += n
      else if (key === 'totalTimelineFrames') total.timelineFrames += n
      else if (key === 'jankyFrames') total.janky += n
    }
  }
  if (!matched) return undefined
  return { ...total, refreshHz }
}

/** 最近帧耗时保留这么多帧，和 framestats 自己的缓冲一样大 */
const RECENT_FRAMES = 120

export interface FrameWindow {
  fps: number
  idle: boolean
  jankRatio?: number
  refreshHz?: number
  recent: number[]
  p50?: number
  p90?: number
  p99?: number
  /** 这一轮最慢的一帧（毫秒），用来打“大卡顿”标记 */
  worstMs?: number
}

/**
 * framestats 每次返回最近约 120 帧，前后两次大部分重叠，按 IntendedVsync 去重后只算新帧。
 * 卡顿：有截止时间（Android 12+）时超过截止时间算卡顿，与 gfxinfo 的 “Frame deadline missed” 一致；
 * 否则超过一个刷新周期算卡顿。
 */
export class FrameTracker {
  private last = 0
  private lastAt?: number
  private recent: number[] = []
  private intervalNs?: number

  ingest(rows: FrameRow[], now: number): FrameWindow {
    const fresh = rows.filter((r) => r.intended > this.last).sort((a, b) => a.intended - b.intended)
    // 同一个 vsync 有多个窗口在画时只算一帧
    const unique = fresh.filter((r, i) => i === 0 || r.intended !== fresh[i - 1].intended)
    const first = this.lastAt === undefined
    const seconds = this.lastAt === undefined ? 1 : Math.max(0.2, (now - this.lastAt) / 1000)
    this.lastAt = now
    if (rows.length) this.last = Math.max(this.last, ...rows.map((r) => r.intended))
    this.intervalNs = unique.find((r) => r.interval)?.interval ?? rows.find((r) => r.interval)?.interval ?? this.intervalNs ?? estimateInterval(rows)

    // 第一轮只记基线：缓冲里的旧帧不是这一秒画的
    const counted = first ? [] : unique
    const durations = counted.map((r) => (r.completed - r.intended) / 1e6)
    this.recent = [...this.recent, ...durations].slice(-RECENT_FRAMES)
    const janky = counted.filter((r) => (r.deadline ? r.completed > r.deadline : this.intervalNs ? r.completed - r.intended > this.intervalNs : false)).length
    const sorted = [...this.recent].sort((a, b) => a - b)
    return {
      fps: Math.round((counted.length / seconds) * 10) / 10,
      idle: counted.length === 0,
      jankRatio: counted.length ? (janky / counted.length) * 100 : undefined,
      refreshHz: this.intervalNs ? Math.round(1e9 / this.intervalNs) : undefined,
      recent: this.recent.map((v) => Math.round(v * 10) / 10),
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      p99: percentile(sorted, 0.99),
      worstMs: durations.length ? Math.max(...durations) : undefined
    }
  }
}

/** 老版本没有 FrameInterval：连续绘制时相邻帧 IntendedVsync 的最小间隔就是刷新周期 */
function estimateInterval(rows: FrameRow[]): number | undefined {
  const xs = [...new Set(rows.map((r) => r.intended))].sort((a, b) => a - b)
  let min = Infinity
  for (let i = 1; i < xs.length; i++) min = Math.min(min, xs[i] - xs[i - 1])
  return min >= 4e6 && min <= 5e7 ? min : undefined
}

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10
}

/* ---------------- 事件日志 ---------------- */

/** 常驻的 logcat：只要崩溃、ANR、进程被杀 / 启动和 lmkd 的查杀日志 */
export const EVENT_LOG_ARGS = ['logcat', '-b', 'events', '-b', 'main', '-T', '1', '-s', 'am_crash:I', 'am_anr:I', 'am_kill:I', 'am_proc_start:I', 'lowmemorykiller:I']

export interface LogEvent {
  kind: Extract<MarkerKind, 'crash' | 'anr' | 'lmk' | 'process'>
  /** 进程名 */
  name: string
  /** 进程启动 / 被杀，用 action 区分 */
  action?: 'start' | 'kill'
  detail?: string
}

/**
 * am_crash / am_anr / am_kill：[user, pid, 进程名, …]；am_proc_start：[user, pid, uid, 进程名, …]；
 * lowmemorykiller（main 缓冲）：Kill 'com.foo' (1234), uid 10100, oom_score_adj 900 …
 */
export function parseEventLog(line: string): LogEvent | undefined {
  const tagged = line.match(/\b(am_crash|am_anr|am_kill|am_proc_start)\s*:\s*\[(.*)\]\s*$/)
  if (tagged) {
    const fields = tagged[2].split(',')
    switch (tagged[1]) {
      case 'am_crash':
        return { kind: 'crash', name: fields[2] ?? '', detail: [fields[4], fields[5]].filter(Boolean).join(': ') || undefined }
      case 'am_anr':
        return { kind: 'anr', name: fields[2] ?? '', detail: fields.slice(4).join(',') || undefined }
      case 'am_kill':
        return { kind: 'process', action: 'kill', name: fields[2] ?? '', detail: fields[4] }
      case 'am_proc_start':
        return { kind: 'process', action: 'start', name: fields[3] ?? '', detail: fields[4] }
    }
  }
  const lmk = line.match(/lowmemorykiller\s*:\s*Kill '([^']+)' \((\d+)\)(.*)$/)
  if (lmk) return { kind: 'lmk', name: lmk[1], detail: lmk[3].replace(/^,\s*/, '').trim() || undefined }
  return undefined
}
