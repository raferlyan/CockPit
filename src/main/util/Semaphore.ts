/** 简单的计数信号量，用于限制同一设备上的并发 adb 调用 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be >= 1')
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  get pending(): number {
    return this.waiters.length
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      // 名额直接转交给下一个等待者，active 不变
      next()
    } else {
      this.active--
    }
  }
}
