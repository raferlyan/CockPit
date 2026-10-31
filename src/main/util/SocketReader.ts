import type { Socket } from 'node:net'

/**
 * 在握手阶段按字节数精确读取 socket，握手完成后 detach 交还剩余数据，
 * 之后由调用方自行监听 data 事件。
 */
export class SocketReader {
  private buffer: Buffer = Buffer.alloc(0)
  private waiter?: { size: number; resolve: (buf: Buffer) => void; reject: (err: Error) => void }
  private ended?: Error

  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.flush()
  }
  private readonly onEnd = () => this.fail(new Error('连接已关闭'))
  private readonly onError = (err: Error) => this.fail(err)

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData)
    socket.on('end', this.onEnd)
    socket.on('close', this.onEnd)
    socket.on('error', this.onError)
  }

  read(size: number, timeoutMs = 10_000): Promise<Buffer> {
    if (this.waiter) return Promise.reject(new Error('并发读取'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined
        reject(new Error(`读取超时（等待 ${size} 字节）`))
      }, timeoutMs)
      this.waiter = {
        size,
        resolve: (buf) => {
          clearTimeout(timer)
          resolve(buf)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      }
      this.flush()
    })
  }

  /** 停止监听并返回尚未读取的数据 */
  detach(): Buffer {
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('close', this.onEnd)
    this.socket.off('error', this.onError)
    const rest = this.buffer
    this.buffer = Buffer.alloc(0)
    return rest
  }

  private flush(): void {
    const waiter = this.waiter
    if (!waiter) return
    if (this.buffer.length >= waiter.size) {
      this.waiter = undefined
      const out = this.buffer.subarray(0, waiter.size)
      this.buffer = this.buffer.subarray(waiter.size)
      waiter.resolve(out)
    } else if (this.ended) {
      this.waiter = undefined
      waiter.reject(this.ended)
    }
  }

  private fail(err: Error): void {
    this.ended ??= err
    this.flush()
  }
}
