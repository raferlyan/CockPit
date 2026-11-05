import { create } from 'zustand'
import type { TraceSource } from '@shared/trace'

const GUIDE_KEY = 'cockpit.guide.done'

function guideDone(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

interface UiState {
  settingsOpen: boolean
  /** 首次打开应用时自动显示使用向导 */
  guideOpen: boolean
  /** 应用管理对话框对应的设备 */
  appsSerial: string | null
  /** 导出设备日志对话框对应的设备 */
  loggerSerial: string | null
  /** 中间区域显示内嵌的 Perfetto UI */
  traceOpen: boolean
  /** Perfetto 里当前加载的 trace，收起后再打开会重新加载 */
  trace: TraceSource | null
  /** root 方式设置对话框；serial 为从设备右键打开时的设备 */
  rootSettings: { serial: string | null } | null
  setSettingsOpen(open: boolean): void
  setGuideOpen(open: boolean): void
  /** 看完或跳过向导，之后不再自动弹出 */
  finishGuide(): void
  openApps(serial: string | null): void
  openLogger(serial: string | null): void
  setTraceOpen(open: boolean): void
  setTrace(trace: TraceSource | null): void
  openRootSettings(serial: string | null): void
  closeRootSettings(): void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  guideOpen: !guideDone(),
  appsSerial: null,
  loggerSerial: null,
  traceOpen: false,
  trace: null,
  rootSettings: null,
  openRootSettings: (serial) => set({ rootSettings: { serial } }),
  closeRootSettings: () => set({ rootSettings: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setGuideOpen: (guideOpen) => set({ guideOpen }),
  finishGuide: () => {
    try {
      localStorage.setItem(GUIDE_KEY, '1')
    } catch {
      // 存储不可用时下次启动还会显示
    }
    set({ guideOpen: false })
  },
  openApps: (appsSerial) => set({ appsSerial }),
  openLogger: (loggerSerial) => set({ loggerSerial }),
  setTraceOpen: (traceOpen) => set({ traceOpen }),
  setTrace: (trace) => set({ trace, traceOpen: true })
}))
