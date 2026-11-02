/** 设备上目录里的一项 */
export interface RemoteEntry {
  name: string
  dir: boolean
}

/** 一个文件的传输结果，失败时 message 为 adb 的错误输出 */
export interface TransferResult {
  source: string
  target: string
  ok: boolean
  message: string
}
