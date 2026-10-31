import { create } from 'zustand'

export type ToastLevel = 'info' | 'warn' | 'error' | 'success'

export interface Toast {
  id: number
  level: ToastLevel
  title: string
  detail?: string
}

interface NotifyState {
  toasts: Toast[]
  dismiss(id: number): void
}

/** 同时最多显示几条，旧的先挤掉 */
const MAX_TOASTS = 4
const DURATION: Record<ToastLevel, number> = { info: 4_000, success: 3_000, warn: 8_000, error: 10_000 }

export const useNotifyStore = create<NotifyState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function schedule(id: number, level: ToastLevel): void {
  clearTimeout(timers.get(id))
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id)
      useNotifyStore.getState().dismiss(id)
    }, DURATION[level])
  )
}

/** 显示一条提示，返回 id，可用 update 原地改写（如“无响应”→“已完成”） */
export function notify(level: ToastLevel, title: string, detail?: string): number {
  // 相同内容短时间内重复出现时不叠加，只刷新计时
  const same = useNotifyStore.getState().toasts.find((t) => t.level === level && t.title === title && t.detail === detail)
  if (same) {
    schedule(same.id, level)
    return same.id
  }
  const id = nextId++
  useNotifyStore.setState((s) => ({ toasts: [...s.toasts, { id, level, title, detail }].slice(-MAX_TOASTS) }))
  schedule(id, level)
  return id
}

export function updateToast(id: number, level: ToastLevel, title: string, detail?: string): void {
  const exists = useNotifyStore.getState().toasts.some((t) => t.id === id)
  if (!exists) {
    notify(level, title, detail)
    return
  }
  useNotifyStore.setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { id, level, title, detail } : t)) }))
  schedule(id, level)
}

/** 去掉 Electron 给 IPC 错误加的前缀：`Error invoking remote method 'x': Error: ...` */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
