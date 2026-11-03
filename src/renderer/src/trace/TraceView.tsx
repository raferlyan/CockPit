import { useEffect, useState } from 'react'
import type { TraceFile, TraceSource } from '@shared/trace'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { useUiStore } from '../settings/uiStore'
import { formatBytes } from '../metrics/format'
import { openTraceFile, useTraceStore } from './traceStore'

/**
 * 内嵌的 Perfetto UI。页面由主进程在本机端口上提供，iframe 与 Cockpit 不同源，
 * Chromium 会把它放进独立的渲染进程：大 trace 占满内存或崩溃都不影响主界面，收起即释放。
 */
export function TraceView() {
  const trace = useUiStore((s) => s.trace)
  const { setTraceOpen } = useUiStore.getState()
  const [base, setBase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 还没打开任何 trace 时默认展开列表
  const [listOpen, setListOpen] = useState(() => useUiStore.getState().trace === null)

  useEffect(() => {
    let alive = true
    window.cockpit.trace.uiUrl().then(
      (url) => alive && setBase(url),
      (e) => alive && setError(errorMessage(e))
    )
    return () => {
      alive = false
    }
  }, [])

  const openFile = async () => {
    try {
      const path = await api.trace.pick()
      if (path) {
        await openTraceFile(path)
        setListOpen(false)
      }
    } catch (e) {
      notify('error', '打开 trace 失败', errorMessage(e))
    }
  }

  // visStart / visEnd 只在页面加载后的第一个 trace 上生效，所以每个 trace 都重新加载 iframe（key），也顺便释放上一个的内存
  const src = base && (trace ? `${base}#!/?${traceQuery(trace)}` : base)

  return (
    <section className="trace-area">
      <div className="mirror-bar">
        <strong>Perfetto</strong>
        {trace && (
          <span className="muted mono trace-current" title={trace.name}>
            {trace.name} · {formatBytes(trace.size)}
          </span>
        )}
        <span className="spacer" />
        <button className={`tool${listOpen ? ' on' : ''}`} title="录制和打开过的 trace" onClick={() => setListOpen(!listOpen)}>
          Trace 列表
        </button>
        <button className="tool" title="选择本机的 .pftrace / .perfetto-trace / systrace 等文件" onClick={openFile}>
          打开 trace…
        </button>
        <button className="tool" title="关闭 Perfetto，释放它占用的内存" onClick={() => setTraceOpen(false)}>
          收起
        </button>
      </div>
      <div className="trace-body">
        {listOpen && (
          <TraceList
            current={trace?.name}
            onOpen={(file) => {
              void openTraceFile(file.path)
              setListOpen(false)
            }}
          />
        )}
        {error ? (
          <div className="trace-message">
            <p>Perfetto UI 无法启动</p>
            <p className="mono muted">{error}</p>
          </div>
        ) : src ? (
          <iframe key={trace?.url ?? 'home'} className="trace-frame" src={src} title="Perfetto UI" allow="clipboard-read; clipboard-write" />
        ) : (
          <div className="trace-message muted">正在启动 Perfetto…</div>
        )}
      </div>
    </section>
  )
}

function traceQuery(trace: TraceSource): string {
  const params = new URLSearchParams({ url: trace.url })
  if (trace.window) {
    params.set('visStart', trace.window.start)
    params.set('visEnd', trace.window.end)
  }
  return params.toString()
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 「文稿/Cockpit/Traces」里的文件，录制完成后自动刷新 */
function TraceList({ current, onOpen }: { current?: string; onOpen(file: TraceFile): void }) {
  const version = useTraceStore((s) => s.libraryVersion)
  const [files, setFiles] = useState<TraceFile[] | null>(null)

  useEffect(() => {
    let alive = true
    api.trace.list().then(
      (list) => alive && setFiles(list),
      (e) => {
        if (alive) setFiles([])
        notify('error', '读取 trace 列表失败', errorMessage(e))
      }
    )
    return () => {
      alive = false
    }
  }, [version])

  const remove = async (file: TraceFile) => {
    if (!window.confirm(`把 ${file.name} 移到废纸篓？`)) return
    try {
      await api.trace.remove(file.path)
      useTraceStore.getState().bumpLibrary()
    } catch (e) {
      notify('error', '删除失败', errorMessage(e))
    }
  }

  return (
    <aside className="trace-list">
      <div className="trace-list-head">
        <span className="muted">录制的 trace</span>
        <button className="link" onClick={() => void api.trace.openDir().catch((e) => notify('error', '打开目录失败', errorMessage(e)))}>
          打开目录
        </button>
      </div>
      {files === null ? (
        <p className="empty">读取中…</p>
      ) : files.length === 0 ? (
        <p className="empty">还没有录制过。在右侧设备信息里点「录制 Trace」开始；也可以用「打开 trace…」查看本机已有的文件。</p>
      ) : (
        <ul>
          {files.map((file) => (
            <li key={file.path} className={file.name === current ? 'on' : undefined}>
              <button className="trace-list-item" title={file.path} onClick={() => onOpen(file)}>
                <span className="trace-list-name">{file.name}</span>
                <span className="muted">
                  {formatTime(file.mtime)} · {formatBytes(file.size)}
                </span>
              </button>
              <span className="trace-list-actions">
                <button className="tool" title="在 Finder / 资源管理器中显示" onClick={() => api.files.reveal(file.path)}>
                  显示
                </button>
                <button className="tool" title="移到废纸篓" onClick={() => void remove(file)}>
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
