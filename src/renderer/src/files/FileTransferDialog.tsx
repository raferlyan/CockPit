import { useCallback, useEffect, useState } from 'react'
import type { RemoteEntry, TransferProgress, TransferResult } from '@shared/files'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { droppedPaths, hasDraggedFiles, useFileStore } from './fileStore'
import { formatBytes, formatRate } from '../metrics/format'
import { t } from '../i18n'

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

/** 本机路径的文件名和所在目录，Windows 和 POSIX 分隔符都认 */
function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index > 0 ? trimmed.slice(0, index) : ''
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
  const [progress, setProgress] = useState<UploadState | null>(null)
  /** 最近一次上传失败的原因，常驻显示，不只靠一闪而过的通知 */
  const [failure, setFailure] = useState<{ message: string; remount?: string; dir?: string } | null>(null)
  const [remounting, setRemounting] = useState(false)
  /** 进行中的上传，可以取消 */
  const [uploadId, setUploadId] = useState<string | null>(null)

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

  /** 随时可以关闭；正在上传时先确认，关闭即取消上传（主进程会中止传输，不会卡住） */
  const requestClose = () => {
    if (uploadId) {
      if (!window.confirm(t('正在上传，关闭对话框会取消上传。确定关闭？'))) return
      api.files.cancel(uploadId)
    }
    closeTransfer()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && closeTransfer()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, closeTransfer])

  const upload = async (targetDir?: string) => {
    const target = targetDir ?? (dirInput.trim() || dir)
    const transferId = crypto.randomUUID()
    const startedAt = Date.now()
    setBusy(t('正在上传 {n} 个文件…', { n: transfer.files.length }))
    setUploadId(transferId)
    setFailure(null)
    // 点下去马上出现进度区，不等主进程的第一条进度
    setProgress({ phase: 'check', index: 0, count: transfer.files.length, name: '', fileSent: 0, fileTotal: 0, sent: 0, total: 0, startedAt, sendStartedAt: null })
    const off = api.files.onProgress((event) => {
      if (event.transferId !== transferId) return
      setProgress((prev) => ({
        ...event,
        startedAt,
        // 速度从真正开始发数据算起，不把检查目录、等 su 授权的时间算进去
        sendStartedAt: prev?.sendStartedAt ?? (event.phase === 'send' && event.fileTotal > 0 ? Date.now() - 1 : null)
      }))
    })
    try {
      const results = await api.files.push(transfer.serial, transfer.files, target, transferId)
      setLog((l) => [...results.map((r) => ({ ...r, direction: 'push' as const })), ...l])
      const failed = results.filter((r) => !r.ok)
      const cancelled = failed.length > 0 && failed.every((r) => /已取消|Cancelled/.test(r.message))
      if (cancelled) notify('info', t('已取消上传'))
      else if (failed.length) {
        notify('error', t('{n} 个文件上传失败', { n: failed.length }), failed[0].message)
        setFailure({ message: [...new Set(failed.map((r) => r.message))].join('\n'), remount: failed.find((r) => r.remount)?.remount, dir: target })
      }
      else notify('success', t('已上传 {n} 个文件到 {dir}', { n: results.length, dir: target }))
      for (const r of results) if (r.ok) removeFile(r.source)
      void browse(target)
    } catch (error) {
      notify('error', t('上传失败'), errorMessage(error))
      setFailure({ message: errorMessage(error) })
    } finally {
      off()
      setProgress(null)
      setBusy(null)
      setUploadId(null)
    }
  }

  /** 用 root 把只读分区重新挂载为可写，成功后重新上传 */
  const remountAndRetry = async (mountPoint: string, target: string) => {
    setRemounting(true)
    try {
      const message = await api.files.remount(transfer.serial, mountPoint)
      notify('success', t('已重新挂载 {point}', { point: mountPoint }), message)
      setFailure(null)
      await upload(target)
    } catch (error) {
      setFailure({ message: errorMessage(error), dir: target })
    } finally {
      setRemounting(false)
    }
  }

  const download = async (entry: RemoteEntry) => {
    const localDir = await api.files.pickDirectory()
    if (!localDir) return
    const remote = joinRemote(dir, entry.name)
    setBusy(t('正在下载 {name}…', { name: entry.name }))
    try {
      const result = await api.files.pull(transfer.serial, remote, localDir)
      setLog((l) => [{ ...result, direction: 'pull' }, ...l])
      if (result.ok) notify('success', t('已下载到 {dir}', { dir: localDir }))
      else notify('error', t('下载失败'), result.message)
    } finally {
      setBusy(null)
    }
  }

  const offlineReason = !online && t('设备不在线')
  const uploadReason = offlineReason || (busy ?? false) || (transfer.files.length === 0 && t('先拖入或选择要上传的文件'))
  const title = device ? `${deviceTitle(device)}（${transfer.serial}）` : transfer.serial

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeTransfer()}>
      <div className="dialog transfer-dialog" role="dialog" aria-label={t('文件传输')}>
        <div className="panel-title-row">
          <h2 className="panel-title">
            {t('文件传输')} · {title}
          </h2>
          <button className="tool" title={uploadId ? t('取消上传并关闭') : t('关闭')} onClick={requestClose}>
            ×
          </button>
        </div>

        <div className="transfer-columns">
          <section className="transfer-local">
            <h3 className="status-heading">{t('本机文件')}</h3>
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
                <p className="muted">{t('把文件拖到这里，或')}</p>
              ) : (
                <ul className="local-files">
                  {transfer.files.map((path) => (
                    <li key={path} title={path}>
                      <span className="local-file-text">
                        <span className="local-file-name mono">{baseName(path)}</span>
                        {/* 目录太长时省略开头；bdi 隔离文字方向，斜杠不会跑到末尾 */}
                        <span className="local-file-dir mono">
                          <bdi dir="ltr">{dirName(path)}</bdi>
                        </span>
                      </span>
                      <button className="tool" title={t('移除')} onClick={() => removeFile(path)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button className="secondary" onClick={() => void api.files.pickLocal().then(addFiles)}>
                {t('选择文件…')}
              </button>
            </div>
          </section>

          <section className="transfer-remote">
            <h3 className="status-heading">{t('设备目标目录')}</h3>
            <form
              className="field-row"
              onSubmit={(e) => {
                e.preventDefault()
                void browse(dirInput)
              }}
            >
              <input className="mono" value={dirInput} onChange={(e) => setDirInput(e.target.value)} spellCheck={false} />
              <button type="submit" className="secondary">
                {t('前往')}
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
                    ↑ {t('上级目录')}
                  </button>
                </li>
              )}
              {listError && <li className="error">{listError}</li>}
              {!listError && entries === null && online && <li className="muted">{t('读取中…')}</li>}
              {entries?.length === 0 && <li className="muted">{t('空目录')}</li>}
              {entries?.map((entry) => (
                <li key={entry.name}>
                  {entry.dir ? (
                    <button className="remote-entry" onClick={() => void browse(joinRemote(dir, entry.name))}>
                      📁 {entry.name}
                    </button>
                  ) : (
                    <span className="remote-entry file">📄 {entry.name}</span>
                  )}
                  <ActionButton className="tool" disabledReason={busy} title={t('下载到本机目录')} onClick={() => void download(entry)}>
                    {t('下载')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {progress && <UploadProgress progress={progress} />}
        {failure && !progress && (
          <div className="transfer-failure" role="alert">
            <strong>{t('上传失败')}</strong>
            <p>{failure.message}</p>
            {failure.remount && failure.dir && (
              <button className="secondary" disabled={remounting || !online} onClick={() => void remountAndRetry(failure.remount!, failure.dir!)}>
                {remounting ? t('正在 remount…') : t('remount {point} 后重试', { point: failure.remount })}
              </button>
            )}
          </div>
        )}

        <div className="dialog-actions">
          {busy && !progress && <span className="muted">{busy}</span>}
          <span className="spacer" />
          {uploadId && (
            <button className="secondary danger" onClick={() => api.files.cancel(uploadId)}>
              {t('取消上传')}
            </button>
          )}
          <ActionButton className="primary" disabledReason={uploadReason} onClick={() => void upload()}>
            {transfer.files.length ? t('上传 {n} 个文件到 {dir}', { n: transfer.files.length, dir: '' }) : t('上传到 {dir}', { dir: '' })}
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
                    {t('打开所在目录')}
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

type UploadState = TransferProgress & { startedAt: number; sendStartedAt: number | null }

/** 每秒刷新一次，没有新进度时也能看到计时在走，不会以为卡死 */
function useTicker(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function phaseLabel(progress: UploadState): string {
  switch (progress.phase) {
    case 'check':
      return t('正在检查目标目录（是否可写、分区是否只读）…')
    case 'root':
      return t('目标目录需要 root，正在获取 root 权限…设备上弹出授权时请点允许')
    case 'root-copy':
      return t('已传到设备临时目录，正在用 root 写入目标位置…')
    case 'send':
      return progress.fileTotal > 0 ? '' : t('正在上传目录（adb push 不提供进度）…')
  }
}

function UploadProgress({ progress }: { progress: UploadState }) {
  const now = useTicker()
  const elapsed = (now - progress.startedAt) / 1000
  const label = phaseLabel(progress)
  const bytes = progress.phase === 'send' && progress.fileTotal > 0
  const percent = progress.total ? Math.min(100, (progress.sent / progress.total) * 100) : 0
  const sendSeconds = progress.sendStartedAt ? (now - progress.sendStartedAt) / 1000 : 0
  const speed = bytes && sendSeconds > 0.5 ? progress.sent / sendSeconds : 0
  const remaining = speed > 0 ? (progress.total - progress.sent) / speed : 0
  const filePercent = progress.fileTotal ? Math.min(100, (progress.fileSent / progress.fileTotal) * 100) : null

  return (
    <div
      className="upload-progress"
      role="progressbar"
      aria-valuenow={bytes ? Math.round(percent) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={label || undefined}
    >
      <div className="upload-progress-head">
        <span className="mono upload-progress-name" title={progress.name}>
          {progress.count > 1 && progress.name && `(${progress.index + 1}/${progress.count}) `}
          {progress.name}
          {bytes && filePercent !== null && progress.count > 1 && ` · ${filePercent.toFixed(0)}%`}
        </span>
        <span className="mono">
          {bytes && `${percent.toFixed(0)}% · ${formatBytes(progress.sent)} / ${formatBytes(progress.total)}`}
          {speed > 0 && ` · ${formatRate(speed)}`}
          {speed > 0 && remaining >= 1 && ` · ${t('剩余 {time}', { time: formatDuration(remaining) })}`}
          {bytes ? ' · ' : ''}
          {t('已用时 {time}', { time: formatDuration(Math.max(0, elapsed)) })}
        </span>
      </div>
      <div className={`bar${bytes ? '' : ' indeterminate'}`}>
        <div className="bar-fill" style={bytes ? { width: `${percent}%` } : undefined} />
      </div>
      {label && <p className="upload-progress-phase muted">{label}</p>}
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t('{s} 秒', { s: Math.ceil(seconds) })
  const minutes = Math.floor(seconds / 60)
  return t('{m} 分 {s} 秒', { m: minutes, s: Math.ceil(seconds % 60) })
}
