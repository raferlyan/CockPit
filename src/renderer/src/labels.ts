import type { Device, DeviceState, RootState } from '@shared/models'
import { t } from './i18n'

export const STATE_LABEL = (): Record<DeviceState, string> => ({
  device: t('在线'),
  offline: t('离线'),
  unauthorized: t('未授权'),
  authorizing: t('授权中'),
  connecting: t('连接中'),
  recovery: 'Recovery',
  rescue: 'Rescue',
  sideload: 'Sideload',
  bootloader: 'Bootloader',
  host: 'Host',
  'no permissions': t('无权限'),
  unknown: t('未知')
})

export const ROOT_LABEL = (): Record<RootState, string> => ({
  adbd: 'adbd root',
  'su-available': t('可 root（未认证）'),
  none: t('无 root'),
  unknown: t('检测中')
})

export function deviceTitle(device: Device): string {
  if (device.info?.model) {
    const brand = device.info.brand || device.info.manufacturer
    return brand && !device.info.model.toLowerCase().startsWith(brand.toLowerCase())
      ? `${capitalize(brand)} ${device.info.model}`
      : device.info.model
  }
  return device.model?.replace(/_/g, ' ') ?? device.serial
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** 非 device 状态下给用户的处理提示 */
export function stateHint(state: DeviceState): string | undefined {
  switch (state) {
    case 'unauthorized':
      return t('请在设备上确认 USB 调试授权弹窗')
    case 'offline':
      return t('设备离线，尝试重新插拔或重启 adb')
    case 'no permissions':
      return t('当前用户无权访问 USB 设备，检查 udev 规则或驱动')
    default:
      return undefined
  }
}
