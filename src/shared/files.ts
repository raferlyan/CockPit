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

/** 上传进度：sent / total 为本批所有文件的累计字节数（目录不计大小） */
export interface TransferProgress {
  /** 当前文件在本批中的下标 */
  index: number
  count: number
  name: string
  fileSent: number
  fileTotal: number
  sent: number
  total: number
}

/** 主进程推给界面的上传进度，transferId 由界面发起上传时生成 */
export interface TransferProgressEvent extends TransferProgress {
  transferId: string
}
