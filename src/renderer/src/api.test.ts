import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CockpitApi } from '@shared/ipc'
import { useNotifyStore } from './notify/notifyStore'

let resolveStart: (value: unknown) => void
let rejectOpen: (error: Error) => void
let api: CockpitApi

beforeAll(async () => {
  // api.ts 在导入时包装 window.cockpit
  vi.stubGlobal('window', {
    cockpit: {
      platform: 'darwin',
      mirror: { start: () => new Promise((r) => (resolveStart = r)), control: vi.fn() },
      terminal: { open: () => new Promise((_, reject) => (rejectOpen = reject)) }
    }
  })
  api = (await import('./api')).api
})

afterEach(() => {
  useNotifyStore.setState({ toasts: [] })
  vi.useRealTimers()
})

const toasts = () => useNotifyStore.getState().toasts.map((t) => `${t.level}:${t.title}`)

describe('api watchdog', () => {
  it('warns after 8s without a reply, then reports completion', async () => {
    vi.useFakeTimers()
    const pending = api.mirror.start('x')
    vi.advanceTimersByTime(7_999)
    expect(toasts()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(toasts()).toEqual(['warn:「启动投屏」已等待 8 秒仍无响应'])
    resolveStart({ sessionId: 's' })
    await pending
    expect(toasts()).toEqual(['success:「启动投屏」已完成'])
  })

  it('turns the warning into an error when the slow call fails, and still rejects', async () => {
    vi.useFakeTimers()
    const pending = api.terminal.open('x', { kind: 'shell', cols: 80, rows: 24 })
    vi.advanceTimersByTime(8_000)
    rejectOpen(new Error('设备不在线'))
    await expect(pending).rejects.toThrow('设备不在线')
    expect(toasts()).toEqual(['error:「打开终端」失败'])
  })

  it('leaves fire-and-forget calls untouched', () => {
    api.mirror.control('s', { type: 'resetVideo' })
    expect(window.cockpit.mirror.control).toHaveBeenCalled()
    expect(api.platform).toBe('darwin')
  })
})
