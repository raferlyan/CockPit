import type { BatteryStatus, LoadSample } from '@shared/metrics'

export function formatKB(kb: number): string {
  if (kb >= 1024 ** 2) return `${(kb / 1024 ** 2).toFixed(kb >= 100 * 1024 ** 2 ? 0 : 1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(kb >= 100 * 1024 ? 0 : 1)} MB`
  return `${kb} KB`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  return formatKB(Math.round(bytes / 1024))
}

export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${Math.round(bytesPerSecond)} B/s`
}

export const BATTERY_STATUS_LABEL: Record<BatteryStatus, string> = {
  charging: '充电中',
  discharging: '放电',
  'not-charging': '未充电',
  full: '已充满',
  unknown: '未知'
}

export function memoryUsedPercent(memory: NonNullable<LoadSample['memory']>): number {
  return ((memory.totalKB - memory.availableKB) / memory.totalKB) * 100
}

/**
 * 把多条各自带时间戳的序列对齐到同一组 x（秒），供 uPlot 使用。
 * 多台设备的采样时刻不同，按整秒归桶；某条序列在该秒没有数据时为 null。
 */
export function alignSeries(series: { t: number; v: number | null | undefined }[][]): [number[], ...(number | null)[][]] {
  const buckets = new Map<number, (number | null)[]>()
  series.forEach((points, index) => {
    for (const point of points) {
      const second = Math.round(point.t / 1000)
      let row = buckets.get(second)
      if (!row) {
        row = new Array(series.length).fill(null)
        buckets.set(second, row)
      }
      row[index] = point.v ?? null
    }
  })
  const xs = [...buckets.keys()].sort((a, b) => a - b)
  return [xs, ...series.map((_, index) => xs.map((x) => buckets.get(x)![index]))]
}
