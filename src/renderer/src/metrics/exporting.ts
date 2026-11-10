import type { AppSample, FrameStats, LoadSample, MetricsMarker } from '@shared/metrics'
import { markerText } from './markers'

export interface ExportData {
  device: string
  serial: string
  /** 毫秒时间戳，闭区间 */
  from: number
  to: number
  history: LoadSample[]
  appHistory: AppSample[]
  frameHistory: FrameStats[]
  markers: MetricsMarker[]
}

/** 按时间范围截取各条序列 */
export function sliceExport(data: Omit<ExportData, 'from' | 'to'>, from: number, to: number): ExportData {
  const within = <T extends { t: number }>(list: T[]) => list.filter((x) => x.t >= from && x.t <= to)
  return {
    ...data,
    from,
    to,
    history: within(data.history),
    appHistory: within(data.appHistory),
    frameHistory: within(data.frameHistory),
    markers: within(data.markers)
  }
}

/**
 * 每秒一行的 CSV：系统负载为主，关注应用和帧统计按整秒对齐合并进来，这一秒里的事件拼在最后一列。
 * 每核占用和频率按设备的核数展开成列。数值保留到合适的小数位，空值留空。
 */
export function buildCsv(data: ExportData): string {
  const cores = Math.max(0, ...data.history.map((s) => s.cpu?.cores.length ?? 0))
  const second = (t: number) => Math.round(t / 1000)
  const apps = new Map(data.appHistory.map((s) => [second(s.t), s]))
  const frames = new Map(data.frameHistory.map((s) => [second(s.t), s]))
  const events = new Map<number, string[]>()
  for (const m of data.markers) {
    const key = second(m.t)
    events.set(key, [...(events.get(key) ?? []), markerText(m)])
  }

  const header = [
    'time',
    'cpu_pct',
    'iowait_pct',
    ...Array.from({ length: cores }, (_, i) => `cpu${i}_pct`),
    ...Array.from({ length: cores }, (_, i) => `cpu${i}_mhz`),
    'mem_used_pct',
    'mem_available_mb',
    'swap_used_mb',
    'temp_cpu_c',
    'temp_gpu_c',
    'temp_battery_c',
    'temp_skin_c',
    'thermal_status',
    'psi_cpu',
    'psi_memory',
    'psi_io',
    'gpu_pct',
    'npu_pct',
    'net_rx_bps',
    'net_tx_bps',
    'battery_pct',
    'app',
    'app_cpu_pct',
    'app_rss_mb',
    'app_pss_mb',
    'app_threads',
    'fps',
    'jank_pct',
    'frame_p90_ms',
    'events'
  ]
  const rows = [header.join(',')]
  for (const s of data.history) {
    const key = second(s.t)
    const app = apps.get(key)
    const frame = frames.get(key)
    const memory = s.memory
    rows.push(
      [
        localTime(s.t),
        num(s.cpu?.total, 1),
        num(s.cpu?.iowait, 1),
        ...Array.from({ length: cores }, (_, i) => num(s.cpu?.cores[i] ?? undefined, 1)),
        ...Array.from({ length: cores }, (_, i) => num(s.cpu?.freqMHz[i] ?? undefined, 0)),
        num(memory ? ((memory.totalKB - memory.availableKB) / memory.totalKB) * 100 : undefined, 1),
        num(memory ? memory.availableKB / 1024 : undefined, 0),
        num(memory ? (memory.swapTotalKB - memory.swapFreeKB) / 1024 : undefined, 0),
        num(s.thermal?.cpu, 1),
        num(s.thermal?.gpu, 1),
        num(s.thermal?.battery, 1),
        num(s.thermal?.skin, 1),
        num(s.thermalStatus, 0),
        num(s.psi?.cpu, 2),
        num(s.psi?.memory, 2),
        num(s.psi?.io, 2),
        num(s.gpu?.busy, 0),
        num(s.npu?.busy, 0),
        num(s.net?.rxBps, 0),
        num(s.net?.txBps, 0),
        num(s.battery?.level, 0),
        app?.pkg ?? frame?.pkg ?? '',
        num(app?.cpu, 1),
        num(app?.rssKB !== undefined ? app.rssKB / 1024 : undefined, 1),
        num(app?.pssKB !== undefined ? app.pssKB / 1024 : undefined, 1),
        num(app?.threads, 0),
        num(frame && !frame.idle ? frame.fps : frame ? 0 : undefined, 1),
        num(frame?.jankRatio, 1),
        num(frame?.p90, 1),
        csvText((events.get(key) ?? []).join('; '))
      ].join(',')
    )
  }
  // 带 BOM，Excel 直接打开时中文不乱码
  return '﻿' + rows.join('\r\n') + '\r\n'
}

/** 完整的原始数据，方便用脚本二次分析 */
export function buildJson(data: ExportData): string {
  return JSON.stringify({ format: 'cockpit-metrics', version: 1, ...data }, null, 2)
}

/** 导出文件名：设备名_起始时间 */
export function exportFileName(data: ExportData, ext: 'csv' | 'json'): string {
  const d = new Date(data.from)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${(data.device || data.serial).replace(/[\\/:*?"<>|\s]+/g, '_')}_${stamp}.${ext}`
}

function num(value: number | undefined | null, digits: number): string {
  return value === undefined || value === null || !Number.isFinite(value) ? '' : String(Number(value.toFixed(digits)))
}

function csvText(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 本地时间 yyyy-MM-dd HH:mm:ss，表格软件能识别为日期时间 */
function localTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
