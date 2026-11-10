import { useEffect, useState } from 'react'
import type { MetricsRecordingFile } from '@shared/metrics'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { formatDateTime, t } from '../i18n'
import { formatBytes } from './format'
import { useReplayStore } from './replayStore'

/** 录制的状态数据文件列表：回看、在文件夹中显示、移到废纸篓 */
export function RecordingsDialog({ onClose }: { onClose(): void }) {
  const [files, setFiles] = useState<MetricsRecordingFile[] | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const open = useReplayStore((s) => s.open)

  const refresh = () =>
    void api.metrics
      .listRecordings()
      .then(setFiles)
      .catch((error) => {
        setFiles([])
        notify('error', t('读取录制列表失败'), errorMessage(error))
      })

  useEffect(() => {
    refresh()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const replay = async (file: MetricsRecordingFile) => {
    setLoading(file.path)
    try {
      open(await api.metrics.loadRecording(file.path))
      onClose()
    } catch (error) {
      notify('error', t('打开录制失败'), errorMessage(error))
    } finally {
      setLoading(null)
    }
  }

  const remove = async (file: MetricsRecordingFile) => {
    if (!window.confirm(t('把 {name} 移到废纸篓？', { name: file.name }))) return
    try {
      await api.metrics.deleteRecording(file.path)
      refresh()
    } catch (error) {
      notify('error', t('删除失败'), errorMessage(error))
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog recordings-dialog" role="dialog" aria-label={t('录制的状态数据')}>
        <div className="panel-title-row">
          <h2 className="panel-title">{t('录制的状态数据')}</h2>
          <button className="tool" title={t('关闭')} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted settings-tip">{t('在设备状态里点「● 录制」开始录制。回看时可以拖选放大、导出，和实时数据一样操作。')}</p>
        {files === null ? (
          <p className="muted">{t('正在读取…')}</p>
        ) : files.length === 0 ? (
          <p className="muted">{t('还没有录制过')}</p>
        ) : (
          <ul className="recording-list">
            {files.map((file) => (
              <li key={file.path}>
                <div className="recording-info">
                  <span className="mono recording-name" title={file.path}>
                    {file.name}
                  </span>
                  <span className="muted">
                    {formatDateTime(file.mtime)} · {formatBytes(file.size)}
                  </span>
                </div>
                <button className="secondary" disabled={loading !== null} onClick={() => void replay(file)}>
                  {loading === file.path ? t('打开中…') : t('回看')}
                </button>
                <button className="tool" title={t('在文件夹中显示')} onClick={() => api.files.reveal(file.path)}>
                  {t('显示')}
                </button>
                <button className="tool" title={t('移到废纸篓')} onClick={() => void remove(file)}>
                  {t('删除')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={() => void api.metrics.openRecordingDir().catch((error) => notify('error', t('打开目录失败'), errorMessage(error)))}>
            {t('打开目录')}
          </button>
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            {t('完成')}
          </button>
        </div>
      </div>
    </div>
  )
}
