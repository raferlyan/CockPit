import { create } from 'zustand'
import type { OpEntry, OpLogEvent } from '@shared/oplog'
import { api } from '../api'

interface OplogState {
  /** 按时间先后排列，新的在后 */
  entries: OpEntry[]
  /** 面板关着时新增的条数，显示在状态栏按钮上 */
  unseen: number
  markSeen(): void
  clear(): Promise<void>
}

export const useOplogStore = create<OplogState>((set) => ({
  entries: [],
  unseen: 0,
  markSeen: () => set({ unseen: 0 }),
  clear: async () => {
    await api.oplog.clear()
    set({ entries: [], unseen: 0 })
  }
}))

/** 应用启动时调用一次：拉取已有记录并订阅更新，返回取消函数 */
export function connectOplog(isOpen: () => boolean): () => void {
  void api.oplog.list().then((entries) => useOplogStore.setState({ entries }))
  return api.oplog.onEvent((event: OpLogEvent) => {
    if (event.type === 'clear') return useOplogStore.setState({ entries: [], unseen: 0 })
    useOplogStore.setState((s) => {
      const index = s.entries.findIndex((e) => e.id === event.entry.id)
      if (index >= 0) {
        const entries = s.entries.slice()
        entries[index] = event.entry
        return { entries }
      }
      return { entries: [...s.entries, event.entry].slice(-300), unseen: isOpen() ? 0 : s.unseen + 1 }
    })
  })
}

/** 一条记录转成可以粘贴到终端或文档里的文本，说明放在 # 注释里 */
export function entryToText(entry: OpEntry, title: string, device: string): string {
  const time = new Date(entry.at).toLocaleString()
  const head = [`# ${time} ${title}`, device && `(${device})`, entry.detail && `· ${entry.detail}`].filter(Boolean).join(' ')
  const lines = [head]
  if (entry.status === 'error' && entry.error) lines.push(`# ✗ ${entry.error.replace(/\n/g, ' ')}`)
  for (const c of entry.commands) {
    if (c.note) lines.push(`# ${c.note}`)
    lines.push(c.text)
  }
  return lines.join('\n')
}
