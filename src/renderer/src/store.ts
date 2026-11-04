import { create } from 'zustand'
import type { AdbStatus, Device } from '@shared/models'
import { api } from './api'
import { notify } from './notify/notifyStore'
import { t } from './i18n'

/** 投屏区最多同时放几台设备（按 2–3 台设计，留一台余量） */
export const MAX_MIRROR_TILES = 4

export type MirrorLayout = 'grid' | 'single'

interface AppState {
  devices: Device[]
  adbStatus: AdbStatus | null
  /** 焦点设备：状态面板、存储浏览跟随它切换 */
  focusedSerial: string | null
  /**
   * 投屏区里的设备（按加入顺序）；切换焦点不会移除，投屏继续进行。
   * 为空时中间区域显示设备状态，用户点「投屏」后才把投屏区换到中间。
   */
  mirrorTiles: string[]
  mirrorLayout: MirrorLayout
  setDevices(devices: Device[]): void
  setAdbStatus(status: AdbStatus): void
  focus(serial: string | null): void
  addTile(serial: string): void
  removeTile(serial: string): void
  /** 关闭全部投屏窗格，中间区域回到设备状态 */
  closeMirrors(): void
  setMirrorLayout(layout: MirrorLayout): void
}

export const useAppStore = create<AppState>((set, get) => ({
  devices: [],
  adbStatus: null,
  focusedSerial: null,
  mirrorTiles: [],
  mirrorLayout: 'grid',
  setDevices: (devices) => {
    const { focusedSerial, mirrorTiles } = get()
    // 焦点设备掉线时切到第一台可用设备
    const stillThere = devices.some((d) => d.serial === focusedSerial)
    const nextFocus = stillThere ? focusedSerial : (devices.find((d) => d.state === 'device')?.serial ?? devices[0]?.serial ?? null)
    // 拔掉的设备移出投屏区；仍在列表中但离线的保留窗格，显示离线提示
    const tiles = mirrorTiles.filter((serial) => devices.some((d) => d.serial === serial))
    set({ devices, focusedSerial: nextFocus, mirrorTiles: tiles })
  },
  setAdbStatus: (adbStatus) => set({ adbStatus }),
  focus: (focusedSerial) => set({ focusedSerial }),
  addTile: (serial) => {
    const { mirrorTiles } = get()
    if (mirrorTiles.includes(serial)) {
      set({ focusedSerial: serial })
      return
    }
    if (mirrorTiles.length >= MAX_MIRROR_TILES) {
      notify('info', t('投屏区最多放 {n} 台设备', { n: MAX_MIRROR_TILES }), t('先关闭一个窗格再添加'))
      return
    }
    set({ mirrorTiles: [...mirrorTiles, serial], focusedSerial: serial })
  },
  removeTile: (serial) =>
    set((s) => {
      const mirrorTiles = s.mirrorTiles.filter((t) => t !== serial)
      // 单台模式下关掉当前窗格时，切到剩下的窗格，避免投屏区空着
      const focusedSerial = s.focusedSerial === serial && s.mirrorLayout === 'single' && mirrorTiles.length ? mirrorTiles[0] : s.focusedSerial
      return { mirrorTiles, focusedSerial }
    }),
  closeMirrors: () => set({ mirrorTiles: [] }),
  setMirrorLayout: (mirrorLayout) => set({ mirrorLayout })
}))

/** 订阅主进程推送，返回取消函数 */
export function connectStore(): () => void {
  const { setDevices, setAdbStatus } = useAppStore.getState()
  void api.devices.list().then(setDevices)
  void api.adb.status().then(setAdbStatus)
  const offDevices = api.devices.onChanged(setDevices)
  const offStatus = api.adb.onStatusChanged(setAdbStatus)
  return () => {
    offDevices()
    offStatus()
  }
}
