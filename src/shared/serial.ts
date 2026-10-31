export interface SerialPortInfo {
  /** macOS 上已换成 /dev/cu.*（tty.* 打开时会等待载波信号而卡住） */
  path: string
  manufacturer?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
}

export type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space'
/** 回车键发送的换行符，不同固件的串口控制台要求不同 */
export type SerialEnter = 'CR' | 'LF' | 'CRLF'

export interface SerialOptions {
  path: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  parity: SerialParity
  stopBits: 1 | 1.5 | 2
  /** 硬件流控 RTS/CTS */
  rtscts: boolean
  enter: SerialEnter
  /** 设备不回显时在本地显示输入 */
  localEcho: boolean
}

export const DEFAULT_SERIAL_OPTIONS: Omit<SerialOptions, 'path'> = {
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  rtscts: false,
  enter: 'CR',
  localEcho: false
}

export const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000, 3000000]
