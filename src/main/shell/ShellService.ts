import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { IpcChannel } from '@shared/ipc'
import type { Device } from '@shared/models'
import type { TerminalEvent, TerminalIdentity, TerminalOpenOptions, TerminalSessionInfo } from '@shared/terminal'
import { detectIdentity } from './prompt'
import { watchOwner } from '../util/ownerLifetime'
import type { PtyLike } from '../root/suDriver'
import { translateError } from '../i18n'
import { formatCommand, recordCommand } from '../oplog/OperationLog'

/** 打开 root 终端时用到的 RootService 能力 */
export interface RootTerminalHooks {
  prepareTerminal(serial: string): Promise<'ready' | 'drive'>
  elevate(serial: string, io: PtyLike): Promise<void>
}

/** 输出合并后再发给渲染进程，logcat 刷屏时避免每行一条 IPC */
const FLUSH_INTERVAL = 16
/** 只保留末尾这么多字符用来识别提示符 */
const TAIL_SIZE = 256

interface Entry {
  info: TerminalSessionInfo
  owner: WebContents
  proc: pty.IPty
  /** 额外的输出订阅（自动 su 时读取提示） */
  taps: Set<(data: string) => void>
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

  /**
   * adbPath 为空时只能打开本机终端。
   * onRootChange：某台设备「是否有终端处于 root 身份」变化时回调
   */
  constructor(
    private readonly adbPath: string | null,
    private readonly onRootChange?: (serial: string, root: boolean) => void,
    private readonly rootHooks?: RootTerminalHooks
  ) {}

  async open(owner: WebContents, serial: string, options: TerminalOpenOptions): Promise<TerminalSessionInfo> {
    const size = { cols: clampSize(options.cols, 80), rows: clampSize(options.rows, 24) }
    let proc: pty.IPty
    let drive = false
    if (options.kind === 'local') {
      proc = spawnLocal(this.adbPath, size)
      serial = ''
    } else {
      if (!this.adbPath) throw new Error('未找到 adb')
      const args = ['-s', serial, 'shell']
      if (options.kind === 'logcat') {
        args.push(['logcat', '-v', 'threadtime', '-v', 'color', options.logcatArgs?.trim()].filter(Boolean).join(' '))
      }
      // adb root 方式要在开 shell 之前重启 adbd
      if (options.kind === 'shell' && options.root && this.rootHooks) drive = (await this.rootHooks.prepareTerminal(serial)) === 'drive'
      recordCommand(formatCommand('adb', args))
      proc = pty.spawn(this.adbPath, args, {
        name: 'xterm-256color',
        ...size,
        cwd: process.env.HOME ?? process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })
    }

    const info: TerminalSessionInfo = { id: randomUUID(), serial, kind: options.kind }
    const entry: Entry = { info, owner, proc, taps: new Set(), pending: '', tail: '', identity: 'unknown' }
    this.sessions.set(info.id, entry)

    proc.onData((data) => {
      for (const tap of entry.taps) tap(data)
      entry.pending += data
      entry.flushTimer ??= setTimeout(() => this.flush(entry), FLUSH_INTERVAL)
      if (options.kind === 'shell') this.trackIdentity(entry, data)
    })
    const unwatch = watchOwner(owner, () => this.close(info.id))
    proc.onExit(({ exitCode }) => {
      unwatch()
      this.flush(entry)
      this.sessions.delete(info.id)
      if (entry.identity === 'root') this.notifyRoot(serial)
      this.emit(owner, { type: 'exit', id: info.id, code: exitCode, reason: entry.closeReason })
    })

    if (drive && this.rootHooks) {
      const io: PtyLike = {
        write: (data) => proc.write(data),
        onData: (listener) => {
          entry.taps.add(listener)
          return () => entry.taps.delete(listener)
        }
      }
      // su 的过程直接显示在终端里；失败时在终端里说明原因，标签保留为普通 shell
      this.rootHooks.elevate(serial, io).catch((error: Error) => {
        if (!this.sessions.has(info.id)) return
        entry.pending += `\r\n\x1b[31m${translateError(`[Cockpit] 进入 root 失败：${error.message}`)}\x1b[0m\r\n`
        this.flush(entry)
        proc.write('\r')
      })
    }

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
      if (entry.info.kind !== 'local' && !online.has(entry.info.serial)) this.close(entry.info.id, '设备已断开')
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
      const wasRoot = entry.identity === 'root'
      entry.identity = identity
      this.emit(entry.owner, { type: 'identity', id: entry.info.id, identity })
      if (wasRoot !== (identity === 'root')) this.notifyRoot(entry.info.serial)
    }
  }

  private notifyRoot(serial: string): void {
    const root = [...this.sessions.values()].some((e) => e.info.serial === serial && e.identity === 'root')
    this.onRootChange?.(serial, root)
  }

  private emit(owner: WebContents, event: TerminalEvent): void {
    if (!owner.isDestroyed()) owner.send(IpcChannel.TerminalEvent, event)
  }
}

/**
 * 本机终端：Windows 用 PowerShell，其它系统用用户的登录 shell（从 Finder 启动时 PATH 很短，登录 shell 会读 profile）。
 * 把 Cockpit 用的 adb 所在目录放到 PATH 最前面，终端里直接敲 adb 就是同一个 adb。
 */
function spawnLocal(adbPath: string | null, size: { cols: number; rows: number }): pty.IPty {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  // Windows 上环境变量名不区分大小写，通常写作 Path
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  if (adbPath) env[pathKey] = [dirname(adbPath), env[pathKey]].filter(Boolean).join(delimiter)
  const [file, args] =
    process.platform === 'win32' ? ['powershell.exe', ['-NoLogo']] : [process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), ['-l']]
  recordCommand(formatCommand(file, args), '本机终端')
  return pty.spawn(file, args, { name: 'xterm-256color', ...size, cwd: homedir(), env: { ...env, TERM: 'xterm-256color' } })
}

function clampSize(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 1000 ? value : fallback
}
