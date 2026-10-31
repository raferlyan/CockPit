import { create } from 'zustand'
import type { LoadSample, MetricsEvent, ProcessInfo, StorageMount } from '@shared/metrics'
import { api } from '../api'

/** 与主进程环形缓冲一致：10 分钟 */
const HISTORY_SIZE = 600

export interface DeviceMetrics {
  history: LoadSample[]
  processes?: ProcessInfo[]
  storage?: StorageMount[]
  error?: string
}

interface MetricsState {
  byDevice: Record<string, DeviceMetrics>
}

export const useMetricsStore = create<MetricsState>(() => ({ byDevice: {} }))

function update(serial: string, patch: (current: DeviceMetrics) => Partial<DeviceMetrics>): void {
  useMetricsStore.setState((s) => {
    const current = s.byDevice[serial] ?? { history: [] }
    return { byDevice: { ...s.byDevice, [serial]: { ...current, ...patch(current) } } }
  })
}

const loaded = new Set<string>()

/** 首次看某台设备时拉取主进程已缓冲的历史，之后靠推送增量更新 */
export function ensureMetrics(serial: string): void {
  if (loaded.has(serial)) return
  loaded.add(serial)
  void api.metrics.snapshot(serial).then((snapshot) => {
    update(serial, (current) => {
      // 快照返回前可能已经收到几条推送，按时间合并去重
      const last = snapshot.history.at(-1)?.t ?? 0
      const history = [...snapshot.history, ...current.history.filter((s) => s.t > last)].slice(-HISTORY_SIZE)
      return {
        history,
        processes: current.processes ?? snapshot.processes,
        storage: current.storage ?? snapshot.storage,
        error: current.error ?? snapshot.error
      }
    })
  })
}

export function connectMetrics(): () => void {
  return api.metrics.onEvent((event: MetricsEvent) => {
    switch (event.type) {
      case 'load':
        update(event.serial, (c) => ({ history: [...c.history.slice(-(HISTORY_SIZE - 1)), event.sample] }))
        break
      case 'processes':
        update(event.serial, () => ({ processes: event.processes }))
        break
      case 'storage':
        update(event.serial, () => ({ storage: event.storage }))
        break
      case 'error':
        update(event.serial, () => ({ error: event.error || undefined }))
        break
    }
  })
}
