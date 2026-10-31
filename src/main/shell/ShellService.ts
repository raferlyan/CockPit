import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { IpcChannel } from '@shared/ipc'
import type { Device } from '@shared/models'
import type { TerminalEvent, TerminalIdentity, TerminalOpenOptions, TerminalSessionInfo } from '@shared/terminal'
import { detectIdentity } from './prompt'
import { watchOwner } from '../util/ownerLifetime'

/** 输出合并后再发给渲染进程，logcat 刷屏时避免每行一条 IPC */
const FLUSH_INTERVAL = 16
/** 只保留末尾这么多字符用来识别提示符 */
const TAIL_SIZE = 256

interface Entry {
  info: TerminalSessionInfo
  owner: WebContents
  proc: pty.IPty
  pending: string
  flushTimer?: NodeJS.Timeout
  tail: string
  identity: TerminalIdentity
  /** 主动关闭或设备离线时记录原因，退出事件里带给界面 */
  closeReason?: string
}

/**
 * 每个终端标签对应一个 node-pty 进程（`adb -s <serial> shell`）。
 * 本地有 PTY 时 adb 会在设备端也分配 PTY，因此 Tab 补全、Ctrl+C、vi 等都可用。
 */
export class ShellService {
  private readonly sessions = new Map<string, Entry>()

  constructor(private readonly adbPath: string) {}

  open(owner: WebContents, serial: string, options: TerminalOpenOptions): TerminalSessionInfo {
    const args = ['-s', serial, 'shell']
    if (options.kind === 'logcat') {
      args.push(['logcat', '-v', 'threadtime', '-v', 'color', options.logcatArgs?.trim()].filter(Boolean).join(' '))
    }

    const proc = pty.spawn(this.adbPath, args, {
      name: 'xterm-256color',
      cols: clampSize(options.cols, 80),
      rows: clampSize(options.rows, 24),
      cwd: process.env.HOME ?? process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
    })

    const info: TerminalSessionInfo = { id: randomUUID(), serial, kind: options.kind }
    const entry: Entry = { info, owner, proc, pending: '', tail: '', identity: 'unknown' }
    this.sessions.set(info.id, entry)

    proc.onData((data) => {
      entry.pending += data
      entry.flushTimer ??= setTimeout(() => this.flush(entry), FLUSH_INTERVAL)
      if (options.kind === 'shell') this.trackIdentity(entry, data)
    })
    const unwatch = watchOwner(owner, () => this.close(info.id))
    proc.onExit(({ exitCode }) => {
      unwatch()
      this.flush(entry)
      this.sessions.delete(info.id)
      this.emit(owner, { type: 'exit', id: info.id, code: exitCode, reason: entry.closeReason })
    })

    return info
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    try {
      entry.proc.resize(clampSize(cols, 80), clampSize(rows, 24))
    } catch {
      // 进程刚退出时 resize 会抛错，忽略
    }
  }

  close(id: string, reason?: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    entry.closeReason ??= reason
    entry.proc.kill()
  }

  /** 设备离线时结束其所有终端 */
  onDevicesChanged(devices: Device[]): void {
    const online = new Set(devices.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const entry of this.sessions.values()) {
      if (!online.has(entry.info.serial)) this.close(entry.info.id, '设备已断开')
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  private flush(entry: Entry): void {
    clearTimeout(entry.flushTimer)
    entry.flushTimer = undefined
    if (!entry.pending) return
    this.emit(entry.owner, { type: 'data', id: entry.info.id, data: entry.pending })
    entry.pending = ''
  }

  private trackIdentity(entry: Entry, data: string): void {
    entry.tail = (entry.tail + data).slice(-TAIL_SIZE)
    const identity = detectIdentity(entry.tail)
    if (identity && identity !== entry.identity) {
      entry.identity = identity
      this.emit(entry.owner, { type: 'identity', id: entry.info.id, identity })
    }
  }

  private emit(owner: WebContents, event: TerminalEvent): void {
    if (!owner.isDestroyed()) owner.send(IpcChannel.TerminalEvent, event)
  }
}

function clampSize(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 1000 ? value : fallback
}
