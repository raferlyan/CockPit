import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RemoteEntry, TransferResult } from '@shared/files'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { useUiStore } from '../settings/uiStore'
import { t } from '../i18n'

const DIR_KEY = 'cockpit.logger.dir'
const LOCAL_KEY = 'cockpit.logger.local'
const DEFAULT_DIR = '/data/logger'
const SHORTCUTS = ['/data/logger', '/data/log', '/data/anr', '/data/tombstones', '/sdcard/Android/log']

function loadKey(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function saveKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时下次回到默认值
  }
}

function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** 文件名筛选：空格分隔的多个关键词都要包含；含 * ? 时按通配符匹配 */
function nameMatcher(query: string): (name: string) => boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return () => true
  const tests = words.map((w) => {
    if (!/[*?]/.test(w)) return (name: string) => name.includes(w)
    const regex = new RegExp(`^${w.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    return (name: string) => regex.test(name)
  })
  return (name) => tests.every((test) => test(name.toLowerCase()))
}

/**
 * 导出设备上的日志目录（默认 /data/logger）：可以按文件名筛选、勾选部分文件，
 * 导出到用户选择的本机目录；需要 root 的目录会自动经 su 读取。
 */
export function LoggerExportDialog({ serial }: { serial: string }) {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const online = device?.state === 'device'
  const close = () => useUiStore.getState().openLogger(null)

  const [dir, setDir] = useState(() => loadKey(DIR_KEY, DEFAULT_DIR))
  const [dirInput, setDirInput] = useState(dir)
  const [localDir, setLocalDir] = useState(() => loadKey(LOCAL_KEY, ''))
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<TransferResult[]>([])

  const browse = useCallback(
    async (target: string) => {
      const next = target.trim() || DEFAULT_DIR
      setDir(next)
      setDirInput(next)
      setEntries(null)
      setListError(null)
      setSelected(new Set())
      try {
        setEntries(await api.files.list(serial, next))
        saveKey(DIR_KEY, next)
      } catch (error) {
        setListError(errorMessage(error))
      }
    },
    [serial]
  )

  useEffect(() => {
    if (online) void browse(dir)
  }, [serial, online])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const visible = useMemo(() => {
    const match = nameMatcher(query)
    return (entries ?? []).filter((e) => match(e.name))
  }, [entries, query])
  const chosen = visible.filter((e) => selected.has(e.name))
  const allChecked = visible.length > 0 && visible.every((e) => selected.has(e.name))

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const pickLocal = async () => {
    const picked = await api.files.pickDirectory()
    if (!picked) return null
    setLocalDir(picked)
    saveKey(LOCAL_KEY, picked)
    return picked
  }

  /** whole：导出整个目录（保留目录本身）；否则逐个导出 targets */
  const exportLogs = async (whole: boolean) => {
    const target = localDir || (await pickLocal())
    if (!target) return
    const paths = whole ? [dir] : (chosen.length ? chosen : visible).map((e) => joinRemote(dir, e.name))
    if (!paths.length) return
    const done: TransferResult[] = []
    for (const [i, path] of paths.entries()) {
      setBusy(t('正在导出 {progress}{name}…', { progress: paths.length > 1 ? `(${i + 1}/${paths.length}) ` : '', name: path }))
      try {
        done.push(await api.files.pull(serial, path, target))
      } catch (error) {
        done.push({ source: path, target, ok: false, message: errorMessage(error) })
      }
    }
    setBusy(null)
    setResults(done)
    const failed = done.filter((r) => !r.ok)
    if (failed.length) notify('error', t('{n} 项导出失败', { n: failed.length }), failed[0].message)
    else {
      notify('success', t('日志已导出到 {dir}', { dir: target }))
      const sep = target.includes('\\') ? '\\' : '/'
      api.files.reveal(paths.length === 1 ? `${target.replace(/[\\/]+$/, '')}${sep}${paths[0].split('/').pop()}` : target)
    }
  }

  const offline = !online && t('设备不在线')
  const busyReason = offline || busy
  const filtered = query.trim().length > 0

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="dialog logger-dialog" role="dialog" aria-label={t('导出设备日志')}>
        <div className="panel-title-row">
          <h2 className="panel-title">
            {t('导出设备日志')} · {device ? deviceTitle(device) : serial}
          </h2>
          <button className="tool" title={t('关闭')} onClick={close} disabled={Boolean(busy)}>
            ×
          </button>
        </div>

        <h3 className="status-heading">{t('设备上的日志目录')}</h3>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault()
            void browse(dirInput)
          }}
        >
          <input className="mono" value={dirInput} onChange={(e) => setDirInput(e.target.value)} spellCheck={false} />
          <button type="submit" className="secondary">
            {t('读取')}
          </button>
        </form>
        <div className="dir-shortcuts">
          {SHORTCUTS.map((path) => (
            <button key={path} className={`chip mono${path === dir ? ' on' : ''}`} onClick={() => void browse(path)}>
              {path}
            </button>
          ))}
        </div>

        <div className="logger-filter">
          <input
            className="mono apps-search"
            placeholder={t('按文件名筛选，空格分隔多个关键词，支持 * ? 通配')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <span className="muted">{entries ? t('{shown} / {total} 项', { shown: visible.length, total: entries.length }) : ''}</span>
        </div>

        <div className="apps-list logger-list">
          {listError && <p className="error">{listError}</p>}
          {!listError && entries === null && <p className="muted">{online ? t('读取中…') : t('设备不在线')}</p>}
          {entries && visible.length === 0 && <p className="muted">{entries.length ? t('没有匹配的文件') : t('空目录')}</p>}
          {visible.length > 0 && (
            <table className="proc-table">
              <thead>
                <tr>
                  <th className="check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      title={t('全选当前列表')}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((e) => e.name)))}
                    />
                  </th>
                  <th>{t('名称')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.name} className={selected.has(entry.name) ? 'selected' : ''} onClick={() => toggle(entry.name)}>
                    <td className="check">
                      <input type="checkbox" checked={selected.has(entry.name)} onChange={() => toggle(entry.name)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="proc-name mono">
                      {entry.dir ? '📁' : '📄'} {entry.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="field-row logger-local">
          <span className="muted">{t('导出到')}</span>
          <code className="mono logger-local-path" title={localDir}>
            {localDir || t('（未选择，导出时会询问）')}
          </code>
          <button className="secondary" onClick={() => void pickLocal()}>
            {t('选择目录…')}
          </button>
        </div>

        <div className="dialog-actions">
          <span className="muted">{busy ?? (chosen.length ? t('已选 {n} 个', { n: chosen.length }) : '')}</span>
          <span className="spacer" />
          <ActionButton className="secondary" disabledReason={busyReason || (!entries && t('目录还没读取成功'))} onClick={() => void exportLogs(true)}>
            {t('导出整个目录')}
          </ActionButton>
          <ActionButton
            className="primary"
            disabledReason={busyReason || (!visible.length && t('没有可导出的文件'))}
            onClick={() => void exportLogs(false)}
          >
            {chosen.length
              ? t('导出所选 {n} 项', { n: chosen.length })
              : filtered
                ? t('导出筛选出的 {n} 项', { n: visible.length })
                : t('导出全部 {n} 项', { n: visible.length })}
          </ActionButton>
        </div>

        {results.length > 0 && (
          <ul className="transfer-log">
            {results.map((item, i) => (
              <li key={i} className={item.ok ? '' : 'error'}>
                <span>{item.ok ? '✓' : '✗'}</span>
                <span className="mono">
                  {item.source} → {item.target}
                </span>
                {!item.ok && <span className="muted">{item.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
