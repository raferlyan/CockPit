import { create } from 'zustand'
import type {
  AppSample,
  FocusState,
  ForegroundApp,
  FrameStats,
  LoadSample,
  MetricsEvent,
  MetricsMarker,
  MetricsRecordingState,
  ProcessInfo,
  StorageMount,
  ThreadInfo
} from '@shared/metrics'
import { api } from '../api'
import { notify } from '../notify/notifyStore'
import { t } from '../i18n'
import { markerText } from './markers'
import { useSettingsStore } from '../settings/settingsStore'

/** 与主进程环形缓冲一致：30 分钟 */
const HISTORY_SIZE = 1800
const MARKER_LIMIT = 1000

export interface DeviceMetrics {
  history: LoadSample[]
  processes?: ProcessInfo[]
  storage?: StorageMount[]
  error?: string
  foreground?: ForegroundApp
  focus?: FocusState
  appHistory?: AppSample[]
  frameHistory?: FrameStats[]
  threads?: ThreadInfo[]
  markers?: MetricsMarker[]
  /** 正在录制到文件 */
  recording?: MetricsRecordingState
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
        error: current.error ?? snapshot.error,
        foreground: current.foreground ?? snapshot.foreground,
        focus: current.focus ?? snapshot.focus,
        appHistory: mergeByTime(snapshot.appHistory, current.appHistory, HISTORY_SIZE),
        frameHistory: mergeByTime(snapshot.frameHistory, current.frameHistory, HISTORY_SIZE),
        threads: current.threads ?? snapshot.threads,
        markers: mergeById(snapshot.markers, current.markers)
      }
    })
  })
}

/**
 * 订阅主进程推送。toastAlerts：告警和关注应用的崩溃 / ANR 弹提示，只在主窗口开，
 * 弹出的状态窗口不重复弹。
 */
export function connectMetrics({ toastAlerts = false }: { toastAlerts?: boolean } = {}): () => void {
  void api.metrics.recordingStatus().then((status) => {
    for (const [serial, recording] of Object.entries(status)) update(serial, () => ({ recording }))
  })
  return api.metrics.onEvent((event: MetricsEvent) => {
    if (toastAlerts && event.type === 'marker') toastMarker(event.serial, event.marker)
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
      case 'foreground':
        update(event.serial, () => ({ foreground: event.foreground ?? undefined }))
        break
      case 'focus':
        // 关注的应用换了，旧应用的曲线和线程不再有意义
        update(event.serial, (c) =>
          c.focus?.pkg === event.focus.pkg ? { focus: event.focus } : { focus: event.focus, appHistory: [], threads: undefined }
        )
        break
      case 'app':
        update(event.serial, (c) => ({ appHistory: [...(c.appHistory ?? []).slice(-(HISTORY_SIZE - 1)), event.sample] }))
        break
      case 'frames':
        update(event.serial, (c) => ({ frameHistory: [...(c.frameHistory ?? []).slice(-(HISTORY_SIZE - 1)), event.stats] }))
        break
      case 'threads':
        update(event.serial, () => ({ threads: event.threads }))
        break
      case 'marker':
        update(event.serial, (c) => ({ markers: [...(c.markers ?? []).slice(-(MARKER_LIMIT - 1)), event.marker] }))
        break
      case 'recording':
        update(event.serial, () => ({ recording: event.recording ?? undefined }))
        break
    }
  })
}

/** 快照与快照返回前已收到的推送按时间合并去重 */
function mergeByTime<T extends { t: number }>(snapshot: T[] | undefined, current: T[] | undefined, limit: number): T[] {
  const base = snapshot ?? []
  const last = base.at(-1)?.t ?? 0
  return [...base, ...(current ?? []).filter((s) => s.t > last)].slice(-limit)
}

function mergeById(snapshot: MetricsMarker[] | undefined, current: MetricsMarker[] | undefined): MetricsMarker[] {
  const seen = new Set((snapshot ?? []).map((m) => m.id))
  return [...(snapshot ?? []), ...(current ?? []).filter((m) => !seen.has(m.id))].slice(-MARKER_LIMIT)
}

function toastMarker(serial: string, marker: MetricsMarker): void {
  const rules = useSettingsStore.getState().alerts
  if (!rules.enabled) return
  if (marker.kind === 'alert' && !marker.resolved) {
    notify('warn', markerText(marker), t('设备 {serial}', { serial }))
    return
  }
  // 崩溃和 ANR 只提示关注的应用，后台进程的崩溃只在时间轴上标出来
  if ((marker.kind === 'crash' || marker.kind === 'anr') && rules.appCrash) {
    const focus = useMetricsStore.getState().byDevice[serial]?.focus?.pkg
    if (focus && (marker.label === focus || marker.label.startsWith(`${focus}:`))) notify('error', markerText(marker), marker.detail)
  }
}
