import { describe, expect, it } from 'vitest'
import { Semaphore } from './Semaphore'

describe('Semaphore', () => {
  it('never exceeds the limit and runs every task', async () => {
    const sem = new Semaphore(2)
    let running = 0
    let peak = 0
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        sem.run(async () => {
          running++
          peak = Math.max(peak, running)
          await new Promise((r) => setTimeout(r, 5))
          running--
          return i
        })
      )
    )
    expect(peak).toBe(2)
    expect(results).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('releases the slot when a task throws', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok')
  })
})
