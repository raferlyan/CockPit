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

/** 目录下一项的占用 */
export interface DiskUsageEntry {
  name: string
  sizeKB: number
  /** 是目录（不含符号链接），可以继续进入 */
  dir: boolean
}

/** `du` 统计的一层目录占用，entries 按大小降序 */
export interface DiskUsage {
  dir: string
  totalKB: number
  entries: DiskUsageEntry[]
  /** 有子目录因权限读不到，数字偏小；可以用 root 重新统计 */
  partial: boolean
  /** 本次以 root 身份统计 */
  root: boolean
}
