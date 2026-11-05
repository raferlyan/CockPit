import type { SerialOptions } from './serial'

/**
 * shell：交互式 adb shell；logcat：`logcat -v color` 加用户参数；serial：本机串口；
 * local：本机终端（Windows 上是 PowerShell，其它系统是登录 shell），PATH 里带上 adb
 */
export type TerminalKind = 'shell' | 'logcat' | 'serial' | 'local'

export interface TerminalOpenOptions {
  kind: Exclude<TerminalKind, 'serial'>
  cols: number
  rows: number
  /** 仅 logcat：附加在 `logcat -v threadtime -v color` 之后，在设备 shell 中展开 */
  logcatArgs?: string
  /** 仅 shell：打开后按设备配置的 root 方式自动切到 root */
  root?: boolean
}

export interface TerminalSessionInfo {
  id: string
  /** adb 设备序列号；串口会话为空 */
  serial: string
  kind: TerminalKind
  /** 仅串口会话 */
  port?: SerialOptions
}

/** 从提示符推断的当前身份：`#` 为 root，`$` 为普通用户 */
export type TerminalIdentity = 'root' | 'user' | 'unknown'

export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'identity'; id: string; identity: TerminalIdentity }
  | { type: 'exit'; id: string; code: number; reason?: string }
