import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage, notify, updateToast, useNotifyStore } from './notifyStore'

afterEach(() => {
  useNotifyStore.setState({ toasts: [] })
  vi.useRealTimers()
})

describe('notify', () => {
  it('merges identical toasts and caps the stack', () => {
    const a = notify('info', '同一条')
    expect(notify('info', '同一条')).toBe(a)
    for (let i = 0; i < 6; i++) notify('error', `第 ${i} 条`)
    const titles = useNotifyStore.getState().toasts.map((t) => t.title)
    expect(titles).toHaveLength(4)
    expect(titles.at(-1)).toBe('第 5 条')
  })

  it('auto-dismisses and can be rewritten in place', () => {
    vi.useFakeTimers()
    const id = notify('warn', '无响应')
    updateToast(id, 'success', '已完成')
    expect(useNotifyStore.getState().toasts).toEqual([{ id, level: 'success', title: '已完成', detail: undefined }])
    vi.advanceTimersByTime(3_001)
    expect(useNotifyStore.getState().toasts).toEqual([])
  })
})

describe('errorMessage', () => {
  it('strips the Electron IPC prefix', () => {
    expect(errorMessage(new Error("Error invoking remote method 'mirror:start': Error: 设备不在线"))).toBe('设备不在线')
    expect(errorMessage(new Error("Error invoking remote method 'x': AdbError: adb timed out"))).toBe('adb timed out')
    expect(errorMessage('plain')).toBe('plain')
  })
})
