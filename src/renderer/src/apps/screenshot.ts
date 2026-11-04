import { create } from 'zustand'
import type { Device } from '@shared/models'
import { api } from '../api'
import { deviceTitle } from '../labels'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'

export interface Shot {
  serial: string
  /** 设备名，用作文件名前缀 */
  label: string
  png: Uint8Array
}

interface ScreenshotState {
  shot: Shot | null
  close(): void
}

/** 截到的图先放在这里，由截图对话框决定直接保存还是编辑后保存 */
export const useScreenshotStore = create<ScreenshotState>((set) => ({
  shot: null,
  close: () => set({ shot: null })
}))

/** 原始分辨率截图，弹出预览对话框 */
export async function takeScreenshot(device: Device): Promise<void> {
  try {
    const png = await api.device.screenshot(device.serial)
    useScreenshotStore.setState({ shot: { serial: device.serial, label: deviceTitle(device), png } })
  } catch (error) {
    notify('error', t('截图失败'), errorMessage(error))
  }
}
