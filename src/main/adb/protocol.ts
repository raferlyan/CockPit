import type { ConnectionType, Device, DeviceState } from '@shared/models'

/** adb server 协议：4 位十六进制长度 + 内容 */
export function encodeRequest(command: string): Buffer {
  const body = Buffer.from(command, 'utf8')
  const len = body.length.toString(16).padStart(4, '0')
  return Buffer.concat([Buffer.from(len, 'ascii'), body])
}

/**
 * 从缓冲区中切出完整的长度前缀消息。
 * 返回已解析的消息和剩余未完成的字节。
 */
export function readLengthPrefixed(buffer: Buffer): { messages: string[]; rest: Buffer } {
  const messages: string[] = []
  let offset = 0
  while (buffer.length - offset >= 4) {
    const len = parseInt(buffer.toString('ascii', offset, offset + 4), 16)
    if (Number.isNaN(len)) throw new Error('Invalid adb length prefix')
    if (buffer.length - offset - 4 < len) break
    messages.push(buffer.toString('utf8', offset + 4, offset + 4 + len))
    offset += 4 + len
  }
  return { messages, rest: buffer.subarray(offset) }
}

const KNOWN_STATES = new Set<DeviceState>([
  'device',
  'offline',
  'unauthorized',
  'authorizing',
  'connecting',
  'recovery',
  'rescue',
  'sideload',
  'bootloader',
  'host'
])

export type ListedDevice = Omit<Device, 'info' | 'root' | 'infoError'>

/**
 * 解析 `adb devices -l` / `host:track-devices-l` 的输出。
 * 例：`c5002490  device usb:1-1 product:OnePlus7Pro_CH model:GM1910 device:OnePlus7Pro transport_id:1`
 */
export function parseDeviceList(text: string): ListedDevice[] {
  const devices: ListedDevice[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue

    const parts = line.split(/\s+/)
    const serial = parts[0]
    let rest = parts.slice(1)

    // "no permissions" 是两个词，后面还可能带说明，单独处理
    let state: DeviceState
    if (rest[0] === 'no' && rest[1] === 'permissions') {
      state = 'no permissions'
      rest = rest.slice(2)
    } else {
      state = KNOWN_STATES.has(rest[0] as DeviceState) ? (rest[0] as DeviceState) : 'unknown'
      rest = rest.slice(1)
    }

    const device: ListedDevice = { serial, state, connection: connectionOf(serial) }
    for (const field of rest) {
      const idx = field.indexOf(':')
      if (idx <= 0) continue
      const key = field.slice(0, idx)
      const value = field.slice(idx + 1)
      switch (key) {
        case 'usb':
          device.usbPath = value
          break
        case 'product':
          device.product = value
          break
        case 'model':
          device.model = value
          break
        case 'device':
          device.deviceName = value
          break
        case 'transport_id':
          device.transportId = value
          break
      }
    }
    devices.push(device)
  }
  return devices
}

/** host:port 或 mDNS 名称（adb-xxx._adb-tls-connect._tcp）视为无线连接 */
export function connectionOf(serial: string): ConnectionType {
  if (/^[\w.-]+:\d+$/.test(serial) || serial.includes('._adb-tls-')) return 'tcp'
  return 'usb'
}
