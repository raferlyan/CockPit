import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { Semaphore } from '../util/Semaphore'
import { formatCommand, recordCommand } from '../oplog/OperationLog'
import { encodeRequest, parseDeviceList, readLengthPrefixed, type ListedDevice } from './protocol'

export interface ExecOptions {
  /** 毫秒，默认 15s */
  timeout?: number
  /** 取消时结束 adb 子进程 */
  signal?: AbortSignal
  /** 操作日志里这条命令的说明，如「上传前检查目标目录」 */
  note?: string
}

export class AdbError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly code?: number | string
  ) {
    super(message)
    this.name = 'AdbError'
  }
}

/** 单设备同时进行的 shell 调用数上限，避免采集命令挤占投屏通道 */
const PER_DEVICE_CONCURRENCY = 4
const DEFAULT_TIMEOUT = 15_000

/**
 * 所有 adb 调用的唯一出口。
 * - 一次性命令通过 adb 二进制执行
 * - 设备追踪直接连接 adb server（默认 tcp:5037），避免常驻子进程
 */
export class AdbClient {
  private readonly limiters = new Map<string, Semaphore>()

  constructor(
    readonly adbPath: string,
    readonly serverPort = Number(process.env.ANDROID_ADB_SERVER_PORT) || 5037
  ) {}

  exec(args: string[], options: ExecOptions = {}): Promise<string> {
    recordCommand(formatCommand('adb', args), options.note)
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        args,
        { timeout: options.timeout ?? DEFAULT_TIMEOUT, maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal: options.signal },
        (error, stdout, stderr) => {
          if (error) {
            if (options.signal?.aborted) {
              reject(new AdbError('已取消', stderr, 'ABORT_ERR'))
              return
            }
            const reason = error.killed
              ? `timed out after ${options.timeout ?? DEFAULT_TIMEOUT}ms`
              : stderr.trim() || `exit code ${error.code}`
            // 命令可能很长，错误信息里只保留开头
            const command = args.join(' ')
            const shown = command.length > 80 ? `${command.slice(0, 80)}…` : command
            reject(new AdbError(`adb ${shown}: ${reason}`, stderr, error.code ?? undefined))
            return
          }
          resolve(stdout)
        }
      )
    })
  }

  /** 输出为二进制的命令，如 `exec-out screencap -p` */
  execBuffer(args: string[], options: ExecOptions = {}): Promise<Buffer> {
    recordCommand(formatCommand('adb', args), options.note)
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        args,
        { timeout: options.timeout ?? DEFAULT_TIMEOUT, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: 'buffer' },
        (error, stdout, stderr) => {
          if (error) {
            const reason = error.killed ? `timed out after ${options.timeout ?? DEFAULT_TIMEOUT}ms` : stderr.toString().trim() || `exit code ${error.code}`
            reject(new AdbError(`adb ${args.join(' ')}: ${reason}`, stderr.toString(), error.code ?? undefined))
            return
          }
          resolve(stdout)
        }
      )
    })
  }

  /** 在设备上执行 shell 命令，按设备限流 */
  shell(serial: string, command: string, options: ExecOptions = {}): Promise<string> {
    return this.limiter(serial).run(() => this.exec(['-s', serial, 'shell', command], options))
  }

  async version(): Promise<string> {
    const out = await this.exec(['version'], { timeout: 5_000 })
    return out.match(/Android Debug Bridge version ([\d.]+)/)?.[1] ?? out.split(/\r?\n/)[0]
  }

  async startServer(): Promise<void> {
    await this.exec(['start-server'], { timeout: 30_000 })
  }

  async connect(address: string): Promise<string> {
    return (await this.exec(['connect', address], { timeout: 20_000 })).trim()
  }

  async disconnect(serial: string): Promise<string> {
    return (await this.exec(['disconnect', serial], { timeout: 10_000 })).trim()
  }

  async push(serial: string, local: string, remote: string): Promise<void> {
    await this.exec(['-s', serial, 'push', local, remote], { timeout: 60_000 })
  }

  /** `adb forward tcp:0 <remote>`，返回分配的本地端口 */
  async forward(serial: string, remote: string): Promise<number> {
    const out = await this.exec(['-s', serial, 'forward', 'tcp:0', remote], { timeout: 10_000 })
    const port = Number(out.trim())
    if (!Number.isInteger(port) || port <= 0) throw new AdbError(`adb forward 返回了无效端口: ${out.trim()}`)
    return port
  }

  async removeForward(serial: string, port: number): Promise<void> {
    await this.exec(['-s', serial, 'forward', '--remove', `tcp:${port}`], { timeout: 10_000 })
  }

  /** 启动长时间运行的 adb 子进程（如 scrcpy-server），调用方负责结束它 */
  spawn(args: string[]): ChildProcessWithoutNullStreams {
    recordCommand(formatCommand('adb', args))
    return spawn(this.adbPath, args, { windowsHide: true })
  }

  /**
   * 订阅设备列表变化（host:track-devices-l）。
   * 连接成功后 adb server 会立即推送一次当前列表，之后每次变化推送全量列表。
   * 返回停止函数；连接断开时调用 onClose，由调用方决定是否重连。
   */
  trackDevices(handlers: {
    onDevices: (devices: ListedDevice[]) => void
    onClose: (error?: Error) => void
  }): () => void {
    const socket: Socket = connect({ host: '127.0.0.1', port: this.serverPort })
    let stopped = false
    let handshakeDone = false
    let buffer: Buffer = Buffer.alloc(0)

    socket.on('connect', () => socket.write(encodeRequest('host:track-devices-l')))

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!handshakeDone) {
        if (buffer.length < 4) return
        const status = buffer.toString('ascii', 0, 4)
        if (status !== 'OKAY') {
          const { messages } = readLengthPrefixed(buffer.subarray(4))
          socket.destroy(new Error(`adb server refused track-devices: ${messages[0] ?? status}`))
          return
        }
        handshakeDone = true
        buffer = buffer.subarray(4)
      }
      try {
        const { messages, rest } = readLengthPrefixed(buffer)
        buffer = rest
        for (const message of messages) handlers.onDevices(parseDeviceList(message))
      } catch (error) {
        socket.destroy(error as Error)
      }
    })

    let closeError: Error | undefined
    socket.on('error', (error) => {
      closeError = error
    })
    socket.on('close', () => {
      if (!stopped) handlers.onClose(closeError)
    })

    return () => {
      stopped = true
      socket.destroy()
    }
  }

  private limiter(serial: string): Semaphore {
    let limiter = this.limiters.get(serial)
    if (!limiter) {
      limiter = new Semaphore(PER_DEVICE_CONCURRENCY)
      this.limiters.set(serial, limiter)
    }
    return limiter
  }
}
