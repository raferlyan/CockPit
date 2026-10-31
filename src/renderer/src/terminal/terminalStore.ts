import { create } from 'zustand'
import type { SerialOptions } from '@shared/serial'
import type { TerminalEvent, TerminalIdentity, TerminalKind, TerminalSessionInfo } from '@shared/terminal'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'

export interface TerminalTab {
  id: string
  serial: string
  kind: TerminalKind
  logcatArgs?: string
  /** 仅串口标签 */
  port?: SerialOptions
  identity: TerminalIdentity
  exit?: { code: number; reason?: string }
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  open(serial: string, kind: Exclude<TerminalKind, 'serial'>, logcatArgs?: string): Promise<void>
  /** 打开串口；成功返回 true，失败时已弹出提示 */
  openSerial(options: SerialOptions): Promise<boolean>
  /** 关闭标签并结束进程 */
  close(id: string): void
  /** 已退出的标签原地重开，保留位置 */
  reopen(id: string): Promise<void>
  activate(id: string): void
}

/** xterm 挂载后会立即按实际尺寸 resize，这里只是初始值 */
const INITIAL_SIZE = { cols: 120, rows: 12 }

function startSession(tab: Pick<TerminalTab, 'serial' | 'kind' | 'logcatArgs' | 'port'>): Promise<TerminalSessionInfo> {
  if (tab.kind === 'serial') return api.terminal.openSerial(tab.port!, INITIAL_SIZE)
  return api.terminal.open(tab.serial, { kind: tab.kind, logcatArgs: tab.logcatArgs, ...INITIAL_SIZE })
}

const FAILED_TITLE: Record<TerminalKind, string> = { shell: '打开终端失败', logcat: '打开 logcat 失败', serial: '打开串口失败' }

export const useTerminalStore = create<TerminalState>((set, get) => {
  const add = async (config: Pick<TerminalTab, 'serial' | 'kind' | 'logcatArgs' | 'port'>): Promise<boolean> => {
    try {
      const info = await startSession(config)
      const tab: TerminalTab = { ...config, id: info.id, identity: 'unknown' }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
      return true
    } catch (error) {
      notify('error', FAILED_TITLE[config.kind], errorMessage(error))
      return false
    }
  }

  return {
    tabs: [],
    activeId: null,
    open: async (serial, kind, logcatArgs) => {
      await add({ serial, kind, logcatArgs })
    },
    openSerial: (port) => add({ serial: '', kind: 'serial', port }),
    close: (id) => {
      void api.terminal.close(id)
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id)
        const tabs = s.tabs.filter((t) => t.id !== id)
        const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeId
        return { tabs, activeId }
      })
    },
    reopen: async (id) => {
      const old = get().tabs.find((t) => t.id === id)
      if (!old) return
      try {
        const info = await startSession(old)
        const tab: TerminalTab = { ...old, id: info.id, identity: 'unknown', exit: undefined }
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? tab : t)), activeId: tab.id }))
      } catch (error) {
        notify('error', FAILED_TITLE[old.kind], errorMessage(error))
      }
    },
    activate: (activeId) => set({ activeId })
  }
})

type DataListener = (data: string) => void

const listeners = new Map<string, DataListener>()
/** 标签的 xterm 还没挂载时先缓存输出（open 返回前进程可能已经输出了提示符） */
const pending = new Map<string, string[]>()

/** 订阅终端输出；注册时会先回放缓存的数据 */
export function listenTerminal(id: string, listener: DataListener): () => void {
  listeners.set(id, listener)
  for (const chunk of pending.get(id) ?? []) listener(chunk)
  pending.delete(id)
  return () => {
    if (listeners.get(id) === listener) listeners.delete(id)
  }
}

/** 应用启动时调用一次，返回取消函数 */
export function connectTerminals(): () => void {
  return api.terminal.onEvent((event: TerminalEvent) => {
    if (event.type === 'data') {
      const listener = listeners.get(event.id)
      if (listener) listener(event.data)
      else pending.set(event.id, [...(pending.get(event.id) ?? []), event.data])
      return
    }
    const patch = event.type === 'identity' ? { identity: event.identity } : { exit: { code: event.code, reason: event.reason } }
    useTerminalStore.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === event.id ? { ...t, ...patch } : t)) }))
    if (event.type === 'exit') {
      // 关掉的标签不会再注册监听，避免缓存一直留着
      if (!useTerminalStore.getState().tabs.some((t) => t.id === event.id)) pending.delete(event.id)
    }
  })
}
