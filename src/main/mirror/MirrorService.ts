import { randomUUID } from 'node:crypto'
import { clipboard, MessageChannelMain, type WebContents } from 'electron'
import type { ControlInput, MirrorEvent, MirrorOptions, MirrorSessionInfo } from '@shared/mirror'
import type { Device } from '@shared/models'
import { IpcChannel } from '@shared/ipc'
import type { AdbClient } from '../adb/AdbClient'
import { MirrorSession } from './MirrorSession'
import { watchOwner } from '../util/ownerLifetime'

interface Entry {
  session: MirrorSession
  owner: WebContents
}

/**
 * 管理所有投屏会话。视频数据通过 MessagePort 直接送到渲染进程的解码 Worker，
 * 控制输入走普通 IPC。
 */
export class MirrorService {
  private readonly sessions = new Map<string, Entry>()

  constructor(
    private readonly adb: AdbClient,
    private readonly serverJar: string
  ) {}

  async start(owner: WebContents, serial: string, options?: MirrorOptions): Promise<MirrorSessionInfo> {
    const sessionId = randomUUID()
    const session = new MirrorSession(this.adb, serial, this.serverJar, options)
    const { port1, port2 } = new MessageChannelMain()

    this.sessions.set(sessionId, { session, owner })
    this.emit(owner, { sessionId, type: 'state', state: 'starting' })

    // 先把端口交给渲染进程，避免丢失握手后的第一批视频消息
    owner.postMessage(IpcChannel.MirrorPort, { sessionId }, [port2])
    session.on('video', (message) => port1.postMessage(message))
    session.on('clipboard', (text) => {
      void (async () => {
        if ((await clipboard.readText()) !== text) await clipboard.writeText(text)
        this.emit(owner, { sessionId, type: 'clipboard', text })
      })()
    })
    const unwatch = watchOwner(owner, () => session.stop())
    session.on('closed', (error) => {
      unwatch()
      this.sessions.delete(sessionId)
      port1.close()
      this.emit(owner, { sessionId, type: 'state', state: error ? 'error' : 'stopped', error: error?.message })
    })

    await session.start()
    this.emit(owner, { sessionId, type: 'state', state: 'running' })
    return { sessionId, serial, deviceName: session.deviceName, codec: session.codec }
  }

  stop(sessionId: string): void {
    this.sessions.get(sessionId)?.session.stop()
  }

  control(sessionId: string, input: ControlInput): void {
    const session = this.sessions.get(sessionId)?.session
    if (!session) return
    if (input.type === 'pasteFromHost') {
      void clipboard.readText().then((text) => {
        if (text) session.sendControl({ type: 'pasteText', text })
      })
      return
    }
    session.sendControl(input)
  }

  /** 设备离线时结束其会话 */
  onDevicesChanged(devices: Device[]): void {
    const online = new Set(devices.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const { session } of this.sessions.values()) {
      if (!online.has(session.serial)) session.stop()
    }
  }

  dispose(): void {
    for (const { session } of this.sessions.values()) session.stop()
  }

  private emit(owner: WebContents, event: MirrorEvent): void {
    if (!owner.isDestroyed()) owner.send(IpcChannel.MirrorEvent, event)
  }
}
