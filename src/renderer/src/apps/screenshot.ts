import type { Device } from '@shared/models'
import { api } from '../api'
import { deviceTitle } from '../labels'
import { errorMessage, notify } from '../notify/notifyStore'

/** 原始分辨率截图，保存到本机「图片/Cockpit」并复制到剪贴板 */
export async function takeScreenshot(device: Device): Promise<void> {
  try {
    const file = await api.device.screenshot(device.serial, deviceTitle(device))
    notify('success', '截图已保存并复制到剪贴板', file)
  } catch (error) {
    notify('error', '截图失败', errorMessage(error))
  }
}
