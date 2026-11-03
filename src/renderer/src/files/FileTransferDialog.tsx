import { useCallback, useEffect, useState } from 'react'
import type { RemoteEntry, TransferProgress, TransferResult } from '@shared/files'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { droppedPaths, hasDraggedFiles, useFileStore } from './fileStore'
import { formatBytes, formatRate } from '../metrics/format'

const DIR_KEY = 'cockpit.transfer.dir'
const DEFAULT_DIR = '/sdcard/Download'
const SHORTCUTS = ['/sdcard/Download', '/sdcard', '/data/local/tmp']

function loadDir(): string {
  try {
    return localStorage.getItem(DIR_KEY) || DEFAULT_DIR
  } catch {
    return DEFAULT_DIR
  }
}

function saveDir(dir: string): void {
  try {
    localStorage.setItem(DIR_KEY, dir)
  } catch {
    // 存储不可用时下次回到默认目录
  }
}

function parentOf(dir: string): string {
  const trimmed = dir.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

interface LogItem extends TransferResult {
  direction: 'push' | 'pull'
}

/**
 * 文件传输：上传前列出本机文件的绝对路径，目标目录可以手输、点快捷目录或在设备目录里浏览选择；
 * 浏览到的文件也可以下载到本机指定目录。
 */
export function FileTransferDialog() {
  const transfer = useFileStore((s) => s.transfer)!
  const { addFiles, removeFile, closeTransfer } = useFileStore.getState()
  const device = useAppStore((s) => s.devices.find((d) => d.serial === transfer.serial))
  const online = device?.state === 'device'

  const [dir, setDir] = useState(loadDir)
  const [dirInput, setDirInput] = useState(dir)
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<LogItem[]>([])
  const [dropping, setDropping] = useState(false)
  const [progress, setProgress] = useState<(TransferProgress & { startedAt: number }) | null>(null)

  const browse = useCallback(
    async (target: string) => {
      const next = target.trim() || '/'
      setDir(next)
      setDirInput(next)
      setEntries(null)
      setListError(null)
      try {
        setEntries(await api.files.list(transfer.serial, next))
        saveDir(next)
      } catch (error) {
        setListError(errorMessage(error))
      }
    },
    [transfer.serial]
  )

  useEffect(() => {
    if (online) void browse(dir)
    // 只在打开对话框、切换设备时读取一次
  }, [transfer.serial, online])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && closeTransfer()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, closeTransfer])

  const upload = async () => {
    const target = dirInput.trim() || dir
    const transferId = crypto.randomUUID()
    const startedAt = Date.now()
    setBusy(`正在上传 ${transfer.files.length} 个文件…`)
    const off = api.files.onProgress((event) => {
      if (event.transferId === transferId) setProgress({ ...event, startedAt })
    })
    try {
      const results = await api.files.push(transfer.serial, transfer.files, target, transferId)
      setLog((l) => [...results.map((r) => ({ ...r, direction: 'push' as const })), ...l])
      const failed = results.filter((r) => !r.ok)
      if (failed.length) notify('error', `${failed.length} 个文件上传失败`, failed[0].message)
      else notify('success', `已上传 ${results.length} 个文件到 ${target}`)
      for (const r of results) if (r.ok) removeFile(r.source)
      void browse(target)
    } catch (error) {
      notify('error', '上传失败', errorMessage(error))
    } finally {
      off()
      setProgress(null)
      setBusy(null)
    }
  }

  const download = async (entry: RemoteEntry) => {
    const localDir = await api.files.pickDirectory()
    if (!localDir) return
    const remote = joinRemote(dir, entry.name)
    setBusy(`正在下载 ${entry.name}…`)
    try {
      const result = await api.files.pull(transfer.serial, remote, localDir)
      setLog((l) => [{ ...result, direction: 'pull' }, ...l])
      if (result.ok) notify('success', `已下载到 ${localDir}`)
      else notify('error', '下载失败', result.message)
    } finally {
      setBusy(null)
    }
  }

  const offlineReason = !online && '设备不在线'
  const uploadReason = offlineReason || (busy ?? false) || (transfer.files.length === 0 && '先拖入或选择要上传的文件')
  const title = device ? `${deviceTitle(device)}（${transfer.serial}）` : transfer.serial

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeTransfer()}>
      <div className="dialog transfer-dialog" role="dialog" aria-label="文件传输">
        <div className="panel-title-row">
          <h2 className="panel-title">文件传输 · {title}</h2>
          <button className="tool" title="关闭" onClick={closeTransfer} disabled={Boolean(busy)}>
            ×
          </button>
        </div>

        <div className="transfer-columns">
          <section className="transfer-local">
            <h3 className="status-heading">本机文件</h3>
            <div
              className={`drop-zone${dropping ? ' dropping' : ''}`}
              onDragOver={(e) => {
                if (!hasDraggedFiles(e)) return
                e.preventDefault()
                setDropping(true)
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDropping(false)
                addFiles(droppedPaths(e))
              }}
            >
              {transfer.files.length === 0 ? (
                <p className="muted">把文件拖到这里，或</p>
              ) : (
                <ul className="local-files">
                  {transfer.files.map((path) => (
                    <li key={path}>
                      <span className="mono" title={path}>
                        {path}
                      </span>
                      <button className="tool" title="移除" onClick={() => removeFile(path)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button className="secondary" onClick={() => void api.files.pickLocal().then(addFiles)}>
                选择文件…
              </button>
            </div>
          </section>

          <section className="transfer-remote">
            <h3 className="status-heading">设备目标目录</h3>
            <form
              className="field-row"
              onSubmit={(e) => {
                e.preventDefault()
                void browse(dirInput)
              }}
            >
              <input className="mono" value={dirInput} onChange={(e) => setDirInput(e.target.value)} spellCheck={false} />
              <button type="submit" className="secondary">
                前往
              </button>
            </form>
            <div className="dir-shortcuts">
              {SHORTCUTS.map((path) => (
                <button key={path} className={`chip mono${path === dir ? ' on' : ''}`} onClick={() => void browse(path)}>
                  {path}
                </button>
              ))}
            </div>
            <ul className="remote-list">
              {dir !== '/' && (
                <li>
                  <button className="remote-entry" onClick={() => void browse(parentOf(dir))}>
                    ↑ 上级目录
                  </button>
                </li>
              )}
              {listError && <li className="error">{listError}</li>}
              {!listError && entries === null && online && <li className="muted">读取中…</li>}
              {entries?.length === 0 && <li className="muted">空目录</li>}
              {entries?.map((entry) => (
                <li key={entry.name}>
                  {entry.dir ? (
                    <button className="remote-entry" onClick={() => void browse(joinRemote(dir, entry.name))}>
                      📁 {entry.name}
                    </button>
                  ) : (
                    <span className="remote-entry file">📄 {entry.name}</span>
                  )}
                  <ActionButton className="tool" disabledReason={busy} title="下载到本机目录" onClick={() => void download(entry)}>
                    下载
                  </ActionButton>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {progress && <UploadProgress progress={progress} />}

        <div className="dialog-actions">
          {busy && !progress && <span className="muted">{busy}</span>}
          <span className="spacer" />
          <ActionButton className="primary" disabledReason={uploadReason} onClick={() => void upload()}>
            {transfer.files.length ? `上传 ${transfer.files.length} 个文件到 ` : '上传到 '}
            {dirInput.trim() || dir}
          </ActionButton>
        </div>

        {log.length > 0 && (
          <ul className="transfer-log">
            {log.map((item, i) => (
              <li key={i} className={item.ok ? '' : 'error'}>
                <span>{item.ok ? '✓' : '✗'}</span>
                <span className="mono">
                  {item.source} → {item.target}
                </span>
                {item.ok && item.direction === 'pull' && (
                  <button className="link" onClick={() => api.files.reveal(item.target)}>
                    打开所在目录
                  </button>
                )}
                {!item.ok && <span className="muted">{item.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UploadProgress({ progress }: { progress: TransferProgress & { startedAt: number } }) {
  const percent = progress.total ? Math.min(100, (progress.sent / progress.total) * 100) : 0
  const seconds = (Date.now() - progress.startedAt) / 1000
  const speed = seconds > 0.5 ? progress.sent / seconds : 0
  const remaining = speed > 0 ? (progress.total - progress.sent) / speed : 0
  const filePercent = progress.fileTotal ? Math.min(100, (progress.fileSent / progress.fileTotal) * 100) : null

  return (
    <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="upload-progress-head">
        <span className="mono upload-progress-name" title={progress.name}>
          {progress.count > 1 && `(${progress.index + 1}/${progress.count}) `}
          {progress.name}
          {filePercent !== null && progress.count > 1 && ` · ${filePercent.toFixed(0)}%`}
        </span>
        <span className="mono">
          {percent.toFixed(0)}% · {formatBytes(progress.sent)} / {formatBytes(progress.total)}
          {speed > 0 && ` · ${formatRate(speed)}`}
          {speed > 0 && remaining >= 1 && ` · 剩余 ${formatDuration(remaining)}`}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分 ${Math.ceil(seconds % 60)} 秒`
}
