import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { randomInt } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ControlInput, MirrorOptions, VideoCodec, VideoMessage } from '@shared/mirror'
import { DEFAULT_MIRROR_OPTIONS } from '@shared/mirror'
import type { AdbClient } from '../adb/AdbClient'
import { SocketReader } from '../util/SocketReader'
import {
  DEVICE_NAME_FIELD_LENGTH,
  DeviceMessageParser,
  parseCodecId,
  parseDeviceName,
  serializeControl,
  VideoStreamParser
} from './protocol'

/** 必须与 resources/scrcpy-server 的版本一致，见 scripts/fetch-scrcpy-server.mjs */
export const SCRCPY_VERSION = '5.0.1'
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar'

const CONNECT_ATTEMPTS = 100
const CONNECT_INTERVAL = 100

interface MirrorSessionEvents {
  video: [VideoMessage]
  clipboard: [string]
  closed: [Error | undefined]
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 单台设备的一路投屏：
 * push server → adb forward → 启动 server → 连接 video/control socket → 转发数据。
 * 任一环节断开都会整体关闭，并通过 closed 事件通知。
 */
export class MirrorSession extends EventEmitter<MirrorSessionEvents> {
  deviceName = ''
  codec: VideoCodec = 'h264'

  private readonly options: Required<MirrorOptions>
  private port?: number
  private server?: ChildProcessWithoutNullStreams
  private serverOutput: string[] = []
  private serverExited = false
  private videoSocket?: Socket
  private controlSocket?: Socket
  private clipboardSequence = 1n
  private closed = false

  constructor(
    private readonly adb: AdbClient,
    readonly serial: string,
    private readonly serverJar: string,
    options: MirrorOptions = {}
  ) {
    super()
    this.options = { ...DEFAULT_MIRROR_OPTIONS, ...options }
  }

  async start(): Promise<void> {
    try {
      await this.adb.push(this.serial, this.serverJar, DEVICE_SERVER_PATH)

      const scid = randomInt(0, 0x7fffffff)
      const socketName = `scrcpy_${scid.toString(16).padStart(8, '0')}`
      this.port = await this.adb.forward(this.serial, `localabstract:${socketName}`)

      this.startServer(scid)

      // forward 模式下 adb 会先接受连接，server 未就绪时随即断开，所以靠 dummy byte 判断真正连通
      const { socket: video, reader: videoReader } = await this.connectWithRetry()
      this.videoSocket = video
      this.controlSocket = await this.connectOnce()

      this.deviceName = parseDeviceName(await videoReader.read(DEVICE_NAME_FIELD_LENGTH))
      this.codec = parseCodecId(await videoReader.read(4))
      this.emit('video', { type: 'codec', codec: this.codec })

      this.pipeVideo(video, videoReader.detach())
      this.pipeControl(this.controlSocket)
    } catch (error) {
      const message = this.describeFailure(error as Error)
      this.close(new Error(message))
      throw new Error(message)
    }
  }

  sendControl(input: ControlInput): void {
    const socket = this.controlSocket
    if (!socket || socket.destroyed) return
    if (input.type === 'pasteFromHost') return // 由 MirrorService 读剪贴板后转成 pasteText
    if (input.type === 'pasteText') {
      socket.write(serializeControl({ type: 'setClipboard', text: input.text, paste: true }, this.clipboardSequence++))
      return
    }
    socket.write(serializeControl(input))
  }

  stop(): void {
    this.close()
  }

  private startServer(scid: number): void {
    const o = this.options
    const params = [
      `scid=${scid.toString(16).padStart(8, '0')}`,
      'log_level=info',
      'tunnel_forward=true',
      'audio=false',
      `video_codec=${o.videoCodec}`,
      `max_size=${o.maxSize}`,
      `video_bit_rate=${o.videoBitRate}`,
      `max_fps=${o.maxFps}`,
      ...(o.stayAwake ? ['stay_awake=true'] : [])
    ]
    const command = `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${params.join(' ')}`
    const server = this.adb.spawn(['-s', this.serial, 'shell', command])
    this.server = server

    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        this.serverOutput.push(line)
        if (this.serverOutput.length > 50) this.serverOutput.shift()
      }
    }
    server.stdout.on('data', collect)
    server.stderr.on('data', collect)
    server.on('exit', () => {
      this.serverExited = true
      this.close(new Error(this.lastServerError() ?? 'scrcpy-server 已退出'))
    })
    server.on('error', (err) => this.close(err))
  }

  private async connectWithRetry(): Promise<{ socket: Socket; reader: SocketReader }> {
    let lastError: Error | undefined
    for (let i = 0; i < CONNECT_ATTEMPTS; i++) {
      if (this.closed || this.serverExited) break
      const socket = await this.connectOnce().catch((err: Error) => {
        lastError = err
        return undefined
      })
      if (socket) {
        const reader = new SocketReader(socket)
        try {
          await reader.read(1, 2_000) // dummy byte
          return { socket, reader }
        } catch (err) {
          lastError = err as Error
          reader.detach()
          socket.destroy()
        }
      }
      await delay(CONNECT_INTERVAL)
    }
    throw lastError ?? new Error('无法连接 scrcpy-server')
  }

  private connectOnce(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: this.port! })
      socket.setNoDelay(true)
      socket.once('connect', () => {
        socket.off('error', reject)
        resolve(socket)
      })
      socket.once('error', reject)
    })
  }

  private pipeVideo(socket: Socket, initial: Buffer): void {
    const parser = new VideoStreamParser()
    const handle = (chunk: Buffer) => {
      try {
        for (const message of parser.push(chunk)) this.emit('video', message)
      } catch (err) {
        this.close(err as Error)
      }
    }
    if (initial.length) handle(initial)
    socket.on('data', handle)
    socket.on('close', () => this.close(this.serverExited ? new Error(this.lastServerError() ?? '视频流已断开') : undefined))
    socket.on('error', (err) => this.close(err))
  }

  private pipeControl(socket: Socket): void {
    const parser = new DeviceMessageParser()
    socket.on('data', (chunk) => {
      try {
        for (const message of parser.push(chunk)) {
          if (message.type === 'clipboard') this.emit('clipboard', message.text)
        }
      } catch (err) {
        this.close(err as Error)
      }
    })
    socket.on('close', () => this.close())
    socket.on('error', (err) => this.close(err))
  }

  private close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.videoSocket?.destroy()
    this.controlSocket?.destroy()
    // socket 关闭后设备端 server 会自行退出（cleanup=true 会恢复设备设置）
    if (this.server && !this.serverExited) this.server.kill()
    if (this.port) void this.adb.removeForward(this.serial, this.port).catch(() => undefined)
    this.emit('video', { type: 'end', error: error?.message })
    this.emit('closed', error)
  }

  private lastServerError(): string | undefined {
    const errors = this.serverOutput.filter((l) => /ERROR|Exception|error:/i.test(l))
    return errors.length ? errors.slice(-3).join('\n') : undefined
  }

  private describeFailure(error: Error): string {
    const serverError = this.lastServerError()
    return serverError ? `${error.message}\n${serverError}` : error.message
  }
}
