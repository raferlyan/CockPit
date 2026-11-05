/** 操作里执行的一条命令；note 说明它在哪儿执行，如「root 会话中执行」 */
export interface OpCommand {
  at: number
  text: string
  note?: string
}

/**
 * 一次用户操作（上传文件、进入 root、截图…）及其执行的命令。
 * label 是中文原文，界面上用 t() 翻译。
 */
export interface OpEntry {
  id: string
  at: number
  /** 设备序列号，本机操作为空 */
  serial: string
  label: string
  detail?: string
  status: 'running' | 'ok' | 'error'
  error?: string
  durationMs?: number
  commands: OpCommand[]
}

export type OpLogEvent = { type: 'upsert'; entry: OpEntry } | { type: 'clear' }
