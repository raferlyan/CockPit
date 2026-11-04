import { create } from 'zustand'
import type { SerialOptions } from '@shared/serial'
import type { TerminalEvent, TerminalIdentity, TerminalKind, TerminalSessionInfo } from '@shared/terminal'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { useSettingsStore } from '../settings/settingsStore'
import { t } from '../i18n'
import { DEFAULT_FILTER, dropLogcatBuffer, type LogcatFilter } from './logcat'

export interface TerminalTab {
  id: string
  serial: string
  kind: TerminalKind
  logcatArgs?: string
  /** 仅串口标签 */
  port?: SerialOptions
  identity: TerminalIdentity
  exit?: { code: number; reason?: string }
  /** 仅 logcat：界面上的筛选条件 */
  logcatFilter?: LogcatFilter
  /** 仅 logcat：暂停滚动，新日志照常缓存 */
  paused?: boolean
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  /** initialInput：打开后立即输入的内容，如 `cd /data/app\r` */
  open(serial: string, kind: Exclude<TerminalKind, 'serial'>, logcatArgs?: string, initialInput?: string): Promise<void>
  /** 打开串口；成功返回 true，失败时已弹出提示 */
  openSerial(options: SerialOptions): Promise<boolean>
  /** 关闭标签并结束进程 */
  close(id: string): void
  /** 已退出的标签原地重开，保留位置 */
  reopen(id: string): Promise<void>
  activate(id: string): void
  setLogcatFilter(id: string, patch: Partial<LogcatFilter>): void
  setPaused(id: string, paused: boolean): void
}

/** xterm 挂载后会立即按实际尺寸 resize，这里只是初始值 */
const INITIAL_SIZE = { cols: 120, rows: 12 }

function startSession(tab: Pick<TerminalTab, 'serial' | 'kind' | 'logcatArgs' | 'port'>): Promise<TerminalSessionInfo> {
  if (tab.kind === 'serial') return api.terminal.openSerial(tab.port!, INITIAL_SIZE)
  return api.terminal.open(tab.serial, { kind: tab.kind, logcatArgs: tab.logcatArgs, ...INITIAL_SIZE })
}

const FAILED_TITLE = (): Record<TerminalKind, string> => ({ shell: t('打开终端失败'), logcat: t('打开 logcat 失败'), serial: t('打开串口失败') })

export const useTerminalStore = create<TerminalState>((set, get) => {
  const add = async (config: Pick<TerminalTab, 'serial' | 'kind' | 'logcatArgs' | 'port'>, initialInput?: string): Promise<boolean> => {
    try {
      const info = await startSession(config)
      const tab: TerminalTab = { ...config, id: info.id, identity: 'unknown', logcatFilter: config.kind === 'logcat' ? DEFAULT_FILTER : undefined }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
      // 终端收起时展开，新标签能直接看到
      useSettingsStore.getState().toggleCollapsed('terminal', false)
      if (initialInput) queueInput(info.id, initialInput)
      return true
    } catch (error) {
      notify('error', FAILED_TITLE()[config.kind], errorMessage(error))
      return false
    }
  }

  return {
    tabs: [],
    activeId: null,
    open: async (serial, kind, logcatArgs, initialInput) => {
      await add({ serial, kind, logcatArgs }, initialInput)
    },
    openSerial: (port) => add({ serial: '', kind: 'serial', port }),
    close: (id) => {
      void api.terminal.close(id)
      dropLogcatBuffer(id)
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
        dropLogcatBuffer(id)
        const tab: TerminalTab = { ...old, id: info.id, identity: 'unknown', exit: undefined }
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? tab : t)), activeId: tab.id }))
      } catch (error) {
        notify('error', FAILED_TITLE()[old.kind], errorMessage(error))
      }
    },
    activate: (activeId) => set({ activeId }),
    setLogcatFilter: (id, patch) =>
      set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, logcatFilter: { ...(tab.logcatFilter ?? DEFAULT_FILTER), ...patch } } : tab)) })),
    setPaused: (id, paused) => set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, paused } : tab)) }))
  }
})

/**
 * 打开时要自动输入的行，等提示符出现后再逐行发送：设备端 shell 还没启动时输入会被丢掉，
 * su 之后也要等 root 提示符出来再发下一行。超时没等到提示符就直接发。
 */
const queued = new Map<string, { lines: string[]; timer: ReturnType<typeof setTimeout> }>()
const PROMPT_WAIT = 5_000

function queueInput(id: string, input: string): void {
  const lines = input.split(/(?<=\r)/).filter(Boolean)
  const flush = () => {
    const entry = queued.get(id)
    if (!entry) return
    queued.delete(id)
    api.terminal.write(id, entry.lines.join(''))
  }
  queued.set(id, { lines, timer: setTimeout(flush, PROMPT_WAIT) })
}

/** 出现新的提示符时发送下一行 */
function sendQueued(id: string): void {
  const entry = queued.get(id)
  if (!entry) return
  const line = entry.lines.shift()
  if (line) api.terminal.write(id, line)
  clearTimeout(entry.timer)
  if (!entry.lines.length) queued.delete(id)
  else entry.timer = setTimeout(() => sendQueued(id), PROMPT_WAIT)
}

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
    if (event.type === 'identity') sendQueued(event.id)
    const patch = event.type === 'identity' ? { identity: event.identity } : { exit: { code: event.code, reason: event.reason } }
    useTerminalStore.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === event.id ? { ...t, ...patch } : t)) }))
    if (event.type === 'exit') {
      // 关掉的标签不会再注册监听，避免缓存一直留着
      if (!useTerminalStore.getState().tabs.some((t) => t.id === event.id)) pending.delete(event.id)
    }
  })
}
