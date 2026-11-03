import { create } from 'zustand'

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
  setSettingsOpen(open: boolean): void
  setGuideOpen(open: boolean): void
  /** 看完或跳过向导，之后不再自动弹出 */
  finishGuide(): void
  openApps(serial: string | null): void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  guideOpen: !guideDone(),
  appsSerial: null,
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
  openApps: (appsSerial) => set({ appsSerial })
}))
