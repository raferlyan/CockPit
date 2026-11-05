import type { RootMethod } from './root'

/** adb 上报的设备状态，与 `adb devices` 输出一致 */
export type DeviceState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'authorizing'
  | 'connecting'
  | 'recovery'
  | 'rescue'
  | 'sideload'
  | 'bootloader'
  | 'host'
  | 'no permissions'
  | 'unknown'

export type ConnectionType = 'usb' | 'tcp'

/**
 * M0 只做粗略探测：adbd 是否以 root 运行、设备上是否有 su。
 * 认证与常驻 root 通道在 M4 的 RootService 中实现。
 */
export type RootState = 'adbd' | 'su-available' | 'none' | 'unknown'

export interface DeviceInfo {
  manufacturer: string
  model: string
  brand: string
  androidVersion: string
  sdk: number
  abi: string
  /** 物理分辨率，例如 1440x3120；取不到时为空 */
  resolution?: string
}

export interface Device {
  serial: string
  state: DeviceState
  connection: ConnectionType
  /** `adb devices -l` 中的附加字段 */
  product?: string
  model?: string
  deviceName?: string
  transportId?: string
  usbPath?: string
  /** 设备进入 `device` 状态后异步拉取 */
  info?: DeviceInfo
  root: RootState
  /** 应用内有终端通过 su 切到了 root（提示符为 #），与 adbd 是否 root 无关 */
  shellRoot?: boolean
  /** 设备列表右键「进入 root」建立的后台 root 会话及其方式 */
  rootSession?: RootMethod
  /** 拉取设备信息失败时的错误 */
  infoError?: string
}

export interface AdbStatus {
  path: string | null
  version?: string
  /** 设备追踪连接是否正常 */
  tracking: boolean
  error?: string
}
