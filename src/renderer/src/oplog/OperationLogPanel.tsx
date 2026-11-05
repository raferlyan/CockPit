import { useEffect, useMemo, useState } from 'react'
import type { OpEntry } from '@shared/oplog'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { notify } from '../notify/notifyStore'
import { useUiStore } from '../settings/uiStore'
import { entryToText, useOplogStore } from './oplogStore'
import { t } from '../i18n'

const ALL = ''
/** 超过这么多字符的命令默认折叠 */
const LONG_COMMAND = 220

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function copy(text: string, what: string): void {
  api.clipboard.writeText(text)
  notify('success', t('已复制{what}', { what }))
}

/**
 * 操作日志：从右侧滑出的面板。每条是一次操作（上传、进入 root、截图…）和它执行的命令，
 * 命令可以单条复制、整条复制或全部复制，粘贴到终端里能直接执行。
 */
export function OperationLogPanel() {
  const entries = useOplogStore((s) => s.entries)
  const devices = useAppStore((s) => s.devices)
  const close = () => useUiStore.getState().setOplogOpen(false)
  const [query, setQuery] = useState('')
  const [serial, setSerial] = useState(ALL)
  const [errorsOnly, setErrorsOnly] = useState(false)
  /** 展开了的长命令，键为「记录 id:序号」 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    useOplogStore.getState().markSeen()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const deviceName = (s: string) => {
    if (!s) return ''
    const d = devices.find((x) => x.serial === s)
    return d ? deviceTitle(d) : s
  }
  /** 出现过的设备，包括已经断开的 */
  const serials = useMemo(() => [...new Set(entries.map((e) => e.serial).filter(Boolean))], [entries])

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return entries
      .filter((e) => (serial === ALL || e.serial === serial) && (!errorsOnly || e.status === 'error'))
      .filter((e) => {
        if (!words.length) return true
        const hay = [t(e.label), e.detail, e.error, ...e.commands.map((c) => c.text)].join('\n').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
      .slice()
      .reverse()
  }, [entries, query, serial, errorsOnly])

  const textOf = (e: OpEntry) => entryToText(e, t(e.label), deviceName(e.serial))

  return (
    <div className="oplog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="oplog-panel" role="dialog" aria-label={t('操作日志')}>
        <header className="oplog-head">
          <div className="oplog-title">
            <h2 className="panel-title">{t('操作日志')}</h2>
            <span className="muted">{t('记录每次操作执行的命令，可以复制到终端或文档里使用')}</span>
          </div>
          <button className="tool" title={t('关闭')} onClick={close}>
            ×
          </button>
        </header>

        <div className="oplog-filters">
          <input value={query} placeholder={t('搜索操作或命令')} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
          <select value={serial} onChange={(e) => setSerial(e.target.value)}>
            <option value={ALL}>{t('全部设备')}</option>
            {serials.map((s) => (
              <option key={s} value={s}>
                {deviceName(s)}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            {t('只看失败')}
          </label>
        </div>

        <div className="oplog-actions">
          <span className="muted">{t('{n} 条操作', { n: visible.length })}</span>
          <span className="spacer" />
          <button
            className="secondary"
            disabled={!visible.length}
            onClick={() => copy([...visible].reverse().map(textOf).join('\n\n'), t('全部命令'))}
          >
            {t('复制全部')}
          </button>
          <button className="secondary" disabled={!entries.length} onClick={() => void useOplogStore.getState().clear()}>
            {t('清空')}
          </button>
        </div>

        <ol className="oplog-list">
          {visible.length === 0 && (
            <li className="oplog-empty muted">{entries.length ? t('没有符合条件的操作') : t('还没有操作记录。上传文件、进入 root、截图、安装应用等操作都会记在这里。')}</li>
          )}
          {visible.map((e) => (
            <li key={e.id} className={`oplog-entry is-${e.status}`}>
              <div className="oplog-entry-head">
                <span className={`oplog-status ${e.status}`} aria-label={e.status} />
                <span className="oplog-time mono">{formatTime(e.at)}</span>
                <b className="oplog-label">{t(e.label)}</b>
                {e.serial && <span className="oplog-device">{deviceName(e.serial)}</span>}
                <span className="spacer" />
                <span className="oplog-duration mono muted">{e.status === 'running' ? t('进行中') : formatDuration(e.durationMs)}</span>
                {e.commands.length > 0 && (
                  <button className="link" onClick={() => copy(textOf(e), t('这条操作的命令'))}>
                    {t('复制')}
                  </button>
                )}
              </div>
              {e.detail && (
                <div className="oplog-detail mono" title={e.detail}>
                  {e.detail}
                </div>
              )}
              {e.status === 'error' && e.error && <div className="oplog-error">{e.error}</div>}
              {e.commands.length > 0 ? (
                <ul className="oplog-commands">
                  {e.commands.map((c, i) => {
                    const key = `${e.id}:${i}`
                    // 内部脚本可能很长，默认只显示几行，复制时仍是完整命令
                    const long = c.text.length > LONG_COMMAND
                    const open = expanded.has(key)
                    return (
                      <li key={i}>
                        {c.note && <span className="oplog-note"># {t(c.note)}</span>}
                        <code className={`mono${long && !open ? ' clamped' : ''}`}>{c.text}</code>
                        {long && (
                          <button className="link oplog-expand" onClick={() => toggle(key)}>
                            {open ? t('收起') : t('展开')}
                          </button>
                        )}
                        <button className="oplog-copy" title={t('复制这条命令')} onClick={() => copy(c.text, t('命令'))}>
                          {t('复制')}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                e.status !== 'running' && <div className="oplog-detail muted">{t('没有执行 adb 命令')}</div>
              )}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
