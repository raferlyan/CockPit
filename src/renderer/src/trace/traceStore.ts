import { create } from 'zustand'
import { TRACE_PRESETS, type TraceRecordEvent, type TraceWindow } from '@shared/trace'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { useUiStore } from '../settings/uiStore'
import { t } from '../i18n'

interface TraceState {
  /** 各设备当前或最近一次的录制进度；done / error 之后保留，方便对话框显示结果 */
  recordings: Record<string, TraceRecordEvent>
  /** 录制对话框对应的设备 */
  dialogSerial: string | null
  /** trace 目录有变化时加一，列表据此刷新 */
  libraryVersion: number
  openDialog(serial: string | null): void
  bumpLibrary(): void
}

export const useTraceStore = create<TraceState>((set) => ({
  recordings: {},
  dialogSerial: null,
  libraryVersion: 0,
  openDialog: (dialogSerial) => set({ dialogSerial }),
  bumpLibrary: () => set((s) => ({ libraryVersion: s.libraryVersion + 1 }))
}))

/** 与主进程 TraceRecorder 取消时的原因一致 */
const CANCELLED = '已取消'

export function isRecordingActive(event: TraceRecordEvent | undefined): boolean {
  return Boolean(event && event.state !== 'done' && event.state !== 'error')
}

export const presetLabel = (id: string) => t(TRACE_PRESETS.find((p) => p.id === id)?.label ?? id)

/** 在内嵌的 Perfetto 里打开本机 trace；window 为打开后先缩放到的时间段 */
export async function openTraceFile(path: string, window?: TraceWindow): Promise<void> {
  try {
    useUiStore.getState().setTrace({ ...(await api.trace.open(path)), window })
  } catch (error) {
    notify('error', t('打开 trace 失败'), errorMessage(error))
  }
}

function apply(event: TraceRecordEvent): void {
  useTraceStore.setState((s) => ({ recordings: { ...s.recordings, [event.serial]: event } }))
}

export function connectTraces(): () => void {
  void api.trace.recordings().then((list) => list.forEach(apply))
  return api.trace.onRecordEvent((event) => {
    const previous = useTraceStore.getState().recordings[event.serial]
    apply(event)
    if (event.message && event.message !== previous?.message && event.state !== 'error') notify('info', event.message)
    if (event.state === 'done' && event.file) {
      useTraceStore.getState().bumpLibrary()
      notify('success', t('{preset} trace 已保存', { preset: presetLabel(event.preset) }), event.file.path)
      // 录完直接在 Perfetto 里打开，对话框随之关闭
      if (useTraceStore.getState().dialogSerial === event.serial) useTraceStore.getState().openDialog(null)
      void openTraceFile(event.file.path, event.window)
    } else if (event.state === 'error') {
      if (event.message === CANCELLED) notify('info', t('已取消录制'))
      else notify('error', t('录制 trace 失败'), event.message)
    }
  })
}
