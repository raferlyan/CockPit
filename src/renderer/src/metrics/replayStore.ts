import { create } from 'zustand'
import type { RecordedSession } from '@shared/metrics'
import { useTimelineStore } from './timelineStore'

/** 正在回看的录制会话；每个窗口各自一份，回看时状态面板显示它而不是实时数据 */
interface ReplayState {
  session: RecordedSession | null
  open(session: RecordedSession): void
  close(): void
}

export const useReplayStore = create<ReplayState>((set) => ({
  session: null,
  open: (session) => {
    // 实时视图的放大范围对录制数据没有意义
    useTimelineStore.getState().resume()
    set({ session })
  },
  close: () => {
    useTimelineStore.getState().resume()
    set({ session: null })
  }
}))
