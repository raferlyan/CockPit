import { create } from 'zustand'

/** 曲线可选的时间窗（分钟），上限与采集缓冲（30 分钟）一致 */
export const WINDOW_OPTIONS = [5, 10, 30] as const
export type ChartWindow = (typeof WINDOW_OPTIONS)[number]
const WINDOW_KEY = 'cockpit.chartWindow'

function loadWindow(): ChartWindow {
  try {
    const value = Number(localStorage.getItem(WINDOW_KEY))
    return (WINDOW_OPTIONS as readonly number[]).includes(value) ? (value as ChartWindow) : 5
  } catch {
    return 5
  }
}

/**
 * 状态面板曲线的时间轴：暂停与放大。所有曲线共用一份，放大一张图其余跟着放大。
 * 每个窗口（主窗口、弹出的状态窗口）各有一份，互不影响。
 */
interface TimelineState {
  /** 暂停时的时间（毫秒）；暂停期间采集照常进行，只是画面停在这一刻 */
  pausedAt: number | null
  /** 放大后的 x 轴范围（秒，与 uPlot 一致）；为空表示显示全部 */
  zoom: [number, number] | null
  /** 实时曲线显示最近几分钟 */
  windowMin: ChartWindow
  setWindow(minutes: ChartWindow): void
  pause(): void
  resume(): void
  /** 放大会顺带暂停，否则新数据不断推入，放大的区间很快就滑出缓冲 */
  setZoom(range: [number, number]): void
  resetZoom(): void
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  pausedAt: null,
  zoom: null,
  windowMin: loadWindow(),
  setWindow: (windowMin) => {
    set({ windowMin })
    try {
      localStorage.setItem(WINDOW_KEY, String(windowMin))
    } catch {
      // 存不下时本次会话内仍然生效
    }
  },
  pause: () => set({ pausedAt: get().pausedAt ?? Date.now() }),
  resume: () => set({ pausedAt: null, zoom: null }),
  setZoom: (zoom) => set({ zoom, pausedAt: get().pausedAt ?? Date.now() }),
  resetZoom: () => set({ zoom: null })
}))
