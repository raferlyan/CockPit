import { randomBytes } from 'node:crypto'
import { stripAnsi } from '../shell/prompt'
import type { PtyLike } from './suDriver'
import { recordCommand } from '../oplog/OperationLog'

interface Job {
  command: string
  timeout: number
  resolve(output: string): void
  reject(error: Error): void
}

/**
 * 已经 su 成功的常驻 `adb shell`，把它当成 root 执行通道。
 * 每条命令前后各输出一个标记行，取两行之间的内容作为输出、结束标记里带退出码。
 * 标记在命令里写成 `"__CK""B…"`，回显的命令行里不会出现连在一起的标记，避免误判。
 * 命令一条一条排队执行，互不交错。
 */
export class RootSession {
  private readonly queue: Job[] = []
  private running = false
  private closed = false

  constructor(
    private readonly io: PtyLike & { kill(): void },
    readonly method: string
  ) {}

  get alive(): boolean {
    return !this.closed
  }

  /**
   * 确认通道可用。不用 stty -echo 关回显：toybox 的 stty 会冲掉还没读走的输入，
   * 紧跟着发的命令会丢；回显的命令行里没有连在一起的标记，不影响解析。
   */
  async init(): Promise<void> {
    await this.exec('true', 10_000, false)
  }

  /** record 为 false 时不记进操作日志（内部探测用） */
  exec(command: string, timeout = 60_000, record = true): Promise<string> {
    if (this.closed) return Promise.reject(new Error('root 会话已结束，请重新进入 root'))
    if (record) recordCommand(command, 'root 会话中执行')
    return new Promise((resolve, reject) => {
      this.queue.push({ command, timeout, resolve, reject })
      void this.next()
    })
  }

  /** 进程退出或主动关闭时调用，排队的命令全部失败 */
  markClosed(): void {
    if (this.closed) return
    this.closed = true
    for (const job of this.queue.splice(0)) job.reject(new Error('root 会话已结束，请重新进入 root'))
  }

  close(): void {
    this.markClosed()
    this.io.kill()
  }

  private async next(): Promise<void> {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    this.running = true
    try {
      job.resolve(await this.run(job))
    } catch (error) {
      job.reject(error as Error)
    } finally {
      this.running = false
      void this.next()
    }
  }

  private run(job: Job): Promise<string> {
    const id = randomBytes(6).toString('hex')
    const begin = `__CKB${id}`
    const end = new RegExp(`__CKE${id}:(\\d+)`)
    let buffer = ''
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        off()
      }
      const off = this.io.onData((data) => {
        buffer += data
        const text = stripAnsi(buffer).replace(/\r/g, '')
        const endMatch = end.exec(text)
        if (!endMatch) return
        finish()
        const start = text.indexOf(`${begin}\n`)
        const output = (start >= 0 ? text.slice(start + begin.length + 1, endMatch.index) : text.slice(0, endMatch.index)).replace(/\n$/, '')
        const code = Number(endMatch[1])
        if (code === 0) resolve(output)
        else reject(new Error(output.trim() || `exit code ${code}`))
      })
      const timer = setTimeout(() => {
        finish()
        // 中断还在跑的命令，会话留着给下一条用
        this.io.write('\x03')
        reject(new Error(`timed out after ${job.timeout}ms`))
      }, job.timeout)
      if (this.closed) {
        finish()
        reject(new Error('root 会话已结束，请重新进入 root'))
        return
      }
      this.io.write(`echo "__CK""B${id}"; ( ${job.command} ) </dev/null 2>&1; echo "__CK""E${id}:$?"\r`)
    })
  }
}
