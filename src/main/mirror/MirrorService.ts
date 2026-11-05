import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, clipboard, MessageChannelMain, type WebContents } from 'electron'
import type { ControlInput, MirrorEvent, MirrorOptions, MirrorSessionInfo, RecordingInfo } from '@shared/mirror'
import type { Device } from '@shared/models'
import { IpcChannel } from '@shared/ipc'
import type { AdbClient } from '../adb/AdbClient'
import { MirrorSession } from './MirrorSession'
import { ScreenRecorder } from './ScreenRecorder'
import { watchOwner } from '../util/ownerLifetime'

interface Entry {
  session: MirrorSession
  owner: WebContents
  recorder?: ScreenRecorder
}

/** 文件名里不能出现的字符 */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'device'
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
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
    session.on('video', (message) => {
      port1.postMessage(message)
      this.sessions.get(sessionId)?.recorder?.push(message)
    })
    session.on('clipboard', (text) => {
      void (async () => {
        if ((await clipboard.readText()) !== text) await clipboard.writeText(text)
        this.emit(owner, { sessionId, type: 'clipboard', text })
      })()
    })
    const unwatch = watchOwner(owner, () => session.stop())
    session.on('closed', (error) => {
      unwatch()
      // 投屏中断时把录了的部分保存下来
      this.finishRecording(sessionId)
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

  /**
   * 开始录屏：直接把投屏收到的 H.264 码流封装成 MP4，保存到「影片/Cockpit」。
   * 请求一个关键帧，录制从它开始。
   */
  async startRecording(sessionId: string): Promise<{ startedAt: number }> {
    const entry = this.sessions.get(sessionId)
    if (!entry) throw new Error('投屏已结束')
    if (entry.recorder) throw new Error('已经在录屏了')
    const dir = join(app.getPath('videos'), 'Cockpit')
    await mkdir(dir, { recursive: true })
    const name = `${safeName(entry.session.deviceName || entry.session.serial)}_${timestamp()}`
    entry.recorder = new ScreenRecorder(join(dir, name))
    entry.session.sendControl({ type: 'resetVideo' })
    const startedAt = Date.now()
    this.emit(entry.owner, { sessionId, type: 'recording', recording: true, startedAt })
    return { startedAt }
  }

  /** 结束录屏，返回保存的文件 */
  stopRecording(sessionId: string): RecordingInfo {
    const result = this.finishRecording(sessionId)
    if (!result) throw new Error('当前没有在录屏')
    return result
  }

  private finishRecording(sessionId: string): RecordingInfo | undefined {
    const entry = this.sessions.get(sessionId)
    const recorder = entry?.recorder
    if (!entry || !recorder) return undefined
    entry.recorder = undefined
    const result = recorder.stop()
    this.emit(entry.owner, { sessionId, type: 'recording', recording: false, result })
    return result
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
    for (const id of this.sessions.keys()) this.finishRecording(id)
    for (const { session } of this.sessions.values()) session.stop()
  }

  private emit(owner: WebContents, event: MirrorEvent): void {
    if (!owner.isDestroyed()) owner.send(IpcChannel.MirrorEvent, event)
  }
}
