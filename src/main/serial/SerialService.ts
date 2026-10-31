import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { WebContents } from 'electron'
import { SerialPort } from 'serialport'
import { IpcChannel } from '@shared/ipc'
import type { SerialEnter, SerialOptions, SerialPortInfo } from '@shared/serial'
import type { TerminalEvent, TerminalSessionInfo } from '@shared/terminal'

/** 与 ShellService 一致：合并输出后再发给渲染进程 */
const FLUSH_INTERVAL = 16

const ENTER: Record<SerialEnter, string> = { CR: '\r', LF: '\n', CRLF: '\r\n' }

interface Entry {
  info: TerminalSessionInfo
  owner: WebContents
  port: SerialPort
  decoder: StringDecoder
  pending: string
  flushTimer?: NodeJS.Timeout
  closeReason?: string
}

/**
 * 本机串口终端（USB 转串口线连接设备的调试串口）。
 * 与 adb 设备无关，不随设备上下线关闭；拔线时串口自行关闭并通知界面。
 */
export class SerialService {
  private readonly sessions = new Map<string, Entry>()

  async list(): Promise<SerialPortInfo[]> {
    const ports = await SerialPort.list()
    return ports.map((p) => ({
      path: toCalloutDevice(p.path),
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      vendorId: p.vendorId,
      productId: p.productId
    }))
  }

  async open(owner: WebContents, options: SerialOptions): Promise<TerminalSessionInfo> {
    const port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      dataBits: options.dataBits,
      parity: options.parity,
      stopBits: options.stopBits,
      rtscts: options.rtscts,
      autoOpen: false
    })
    await new Promise<void>((resolve, reject) => port.open((error) => (error ? reject(new Error(describeOpenError(options.path, error))) : resolve())))

    const info: TerminalSessionInfo = { id: randomUUID(), serial: '', kind: 'serial', port: options }
    // 串口输出可能在多字节 UTF-8 字符中间断开，用 StringDecoder 拼接
    const entry: Entry = { info, owner, port, decoder: new StringDecoder('utf8'), pending: '' }
    this.sessions.set(info.id, entry)

    port.on('data', (chunk: Buffer) => this.push(entry, entry.decoder.write(chunk)))
    port.on('error', (error) => {
      entry.closeReason ??= error.message
    })
    port.on('close', (error?: Error & { disconnected?: boolean }) => {
      this.push(entry, entry.decoder.end())
      this.flush(entry)
      this.sessions.delete(info.id)
      const reason = error?.disconnected ? '串口已断开（线被拔出？）' : (entry.closeReason ?? error?.message ?? '串口已关闭')
      this.emit(owner, { type: 'exit', id: info.id, code: 0, reason })
    })

    owner.once('destroyed', () => this.close(info.id))
    return info
  }

  /** 不是串口会话的 id 直接忽略（终端的写入同时分发给 adb 终端和串口） */
  write(id: string, data: string): void {
    const entry = this.sessions.get(id)
    if (!entry?.port.isOpen) return
    const options = entry.info.port!
    entry.port.write(Buffer.from(data.replace(/\r/g, ENTER[options.enter]), 'utf8'))
    if (options.localEcho) this.push(entry, localEcho(data))
  }

  close(id: string, reason?: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    entry.closeReason ??= reason
    if (entry.port.isOpen) entry.port.close()
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  private push(entry: Entry, text: string): void {
    if (!text) return
    entry.pending += text
    entry.flushTimer ??= setTimeout(() => this.flush(entry), FLUSH_INTERVAL)
  }

  private flush(entry: Entry): void {
    clearTimeout(entry.flushTimer)
    entry.flushTimer = undefined
    if (!entry.pending) return
    this.emit(entry.owner, { type: 'data', id: entry.info.id, data: entry.pending })
    entry.pending = ''
  }

  private emit(owner: WebContents, event: TerminalEvent): void {
    if (!owner.isDestroyed()) owner.send(IpcChannel.TerminalEvent, event)
  }
}

/** 本地回显：回车换行，退格擦掉前一个字符 */
export function localEcho(data: string): string {
  return data.replace(/\r/g, '\r\n').replace(/\x7f/g, '\b \b')
}

/** macOS 的 /dev/tty.* 打开时会阻塞等待 DCD，主动连接应使用对应的 /dev/cu.* */
export function toCalloutDevice(path: string, platform = process.platform): string {
  return platform === 'darwin' ? path.replace(/^\/dev\/tty\./, '/dev/cu.') : path
}

/** 把常见的打开失败翻译成可操作的提示 */
export function describeOpenError(path: string, error: Error): string {
  const message = error.message
  if (/busy|EBUSY|Access denied|resource busy/i.test(message)) return `${path} 被其它程序占用，请先关闭串口工具或其它终端：${message}`
  if (/ENOENT|No such file|cannot find|File not found/i.test(message)) return `找不到 ${path}，检查串口线是否插好、驱动是否安装：${message}`
  if (/EACCES|Permission denied/i.test(message)) return `没有权限打开 ${path}：${message}`
  return `打开 ${path} 失败：${message}`
}
