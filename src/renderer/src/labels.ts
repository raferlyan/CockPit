import type { Device, DeviceState, RootState } from '@shared/models'

export const STATE_LABEL: Record<DeviceState, string> = {
  device: '在线',
  offline: '离线',
  unauthorized: '未授权',
  authorizing: '授权中',
  connecting: '连接中',
  recovery: 'Recovery',
  rescue: 'Rescue',
  sideload: 'Sideload',
  bootloader: 'Bootloader',
  host: 'Host',
  'no permissions': '无权限',
  unknown: '未知'
}

export const ROOT_LABEL: Record<RootState, string> = {
  adbd: 'adbd root',
  'su-available': '可 root（未认证）',
  none: '无 root',
  unknown: '检测中'
}

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
      return '请在设备上确认 USB 调试授权弹窗'
    case 'offline':
      return '设备离线，尝试重新插拔或重启 adb'
    case 'no permissions':
      return '当前用户无权访问 USB 设备，检查 udev 规则或驱动'
    default:
      return undefined
  }
}
