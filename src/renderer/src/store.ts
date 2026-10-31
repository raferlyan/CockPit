import { create } from 'zustand'
import type { AdbStatus, Device } from '@shared/models'
import { api } from './api'

interface AppState {
  devices: Device[]
  adbStatus: AdbStatus | null
  /** 焦点设备：状态面板、存储浏览跟随它切换 */
  focusedSerial: string | null
  setDevices(devices: Device[]): void
  setAdbStatus(status: AdbStatus): void
  focus(serial: string | null): void
}

export const useAppStore = create<AppState>((set, get) => ({
  devices: [],
  adbStatus: null,
  focusedSerial: null,
  setDevices: (devices) => {
    const { focusedSerial } = get()
    // 焦点设备掉线时切到第一台可用设备
    const stillThere = devices.some((d) => d.serial === focusedSerial)
    set({
      devices,
      focusedSerial: stillThere ? focusedSerial : (devices.find((d) => d.state === 'device')?.serial ?? devices[0]?.serial ?? null)
    })
  },
  setAdbStatus: (adbStatus) => set({ adbStatus }),
  focus: (focusedSerial) => set({ focusedSerial })
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
