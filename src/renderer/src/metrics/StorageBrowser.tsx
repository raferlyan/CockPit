import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiskUsage } from '@shared/files'
import type { StorageMount } from '@shared/metrics'
import { api } from '../api'
import { errorMessage } from '../notify/notifyStore'
import { useAppStore } from '../store'
import { useTerminalStore } from '../terminal/terminalStore'
import { t } from '../i18n'
import { formatKB } from './format'

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function parentOf(dir: string): string {
  const trimmed = dir.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

/** 在新的 Shell 标签里进入目录；需要 root 才能看的目录先 su */
function openInTerminal(serial: string, dir: string, root: boolean): void {
  void useTerminalStore.getState().open(serial, 'shell', undefined, `${root ? 'su\r' : ''}cd ${shellQuote(dir)} && ls\r`)
}

/** 和 /data 同一分区、df 里不单独列出的常用目录 */
const SHORTCUTS = ['/sdcard', '/sdcard/Android/data', '/data/local/tmp']

/** 手输路径直接进入 */
function PathField({ onGo }: { onGo(path: string): void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="storage-go"
      onSubmit={(e) => {
        e.preventDefault()
        const path = value.trim()
        if (path.startsWith('/')) onGo(path.replace(/(.)\/+$/, '$1'))
      }}
    >
      <input className="mono" value={value} placeholder={t('输入目录，如 /sdcard/DCIM')} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
      <button type="submit" className="tool">
        {t('前往')}
      </button>
    </form>
  )
}

interface Location {
  /** 从哪个挂载点进入，面包屑从这里开始 */
  base: string
  path: string
}

/**
 * 首页的存储：先列出各分区的总占用，点击分区后逐层进入，显示每个子目录 / 文件的大小（du）。
 * 读不到的目录可以一键用 root 重新统计；每个目录都能在终端里打开。
 */
export function StorageBrowser({ serial, mounts }: { serial: string; mounts: StorageMount[] }) {
  const [location, setLocation] = useState<Location | null>(null)
  const [usage, setUsage] = useState<DiskUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 用户选过 root 统计后，后续进入的目录都用 root */
  const [asRoot, setAsRoot] = useState(false)
  const cache = useRef(new Map<string, DiskUsage>())
  const request = useRef(0)
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const canRoot = device?.root === 'su-available' || device?.root === 'adbd' || Boolean(device?.shellRoot)

  // 切换设备时回到分区列表
  useEffect(() => {
    setLocation(null)
    setAsRoot(false)
    cache.current.clear()
  }, [serial])

  const load = useCallback(
    async (path: string, root: boolean, force = false) => {
      const key = `${root ? 'root' : 'shell'}:${path}`
      const cached = cache.current.get(key)
      setError(null)
      if (cached && !force) {
        setUsage(cached)
        return
      }
      const id = ++request.current
      setLoading(true)
      setUsage(null)
      try {
        const result = await api.files.diskUsage(serial, path, root)
        cache.current.set(key, result)
        if (id === request.current) setUsage(result)
      } catch (err) {
        if (id === request.current) setError(errorMessage(err))
      } finally {
        if (id === request.current) setLoading(false)
      }
    },
    [serial]
  )

  const go = (next: Location | null) => {
    setLocation(next)
    if (next) void load(next.path, asRoot)
    else {
      request.current++
      setLoading(false)
    }
  }

  const useRoot = () => {
    setAsRoot(true)
    if (location) void load(location.path, true)
  }

  if (!location) {
    return (
      <div className="storage-mounts">
        <div className="storage-shortcuts">
          {SHORTCUTS.map((path) => (
            <button key={path} className="chip mono" onClick={() => go({ base: path, path })}>
              {path}
            </button>
          ))}
          <PathField onGo={(path) => go({ base: path, path })} />
        </div>
        {mounts.map((m) => {
          const percent = (m.usedKB / m.sizeKB) * 100
          return (
            <button key={m.mount} className="storage-row storage-mount" title={t('点击查看各目录占用')} onClick={() => go({ base: m.mount, path: m.mount })}>
              <div className="storage-label">
                <span className="mono">{m.mount}</span>
                <span className="muted">
                  {t('{used} / {size}（剩余 {avail}）', { used: formatKB(m.usedKB), size: formatKB(m.sizeKB), avail: formatKB(m.availKB) })}
                  <span className="storage-chevron">›</span>
                </span>
              </div>
              <div className="bar">
                <div className={`bar-fill${percent > 90 ? ' danger' : ''}`} style={{ width: `${percent}%` }} />
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  // 面包屑：挂载点 + 之后的每一级
  const rest = location.path.slice(location.base.length).split('/').filter(Boolean)
  const crumbs = [{ label: location.base, path: location.base }, ...rest.map((name, i) => ({ label: name, path: joinPath(location.base, rest.slice(0, i + 1).join('/')) }))]
  const max = usage?.entries[0]?.sizeKB ?? 0

  return (
    <div className="storage-browser">
      <div className="storage-crumbs">
        <button className="link" onClick={() => go(null)}>
          {t('全部分区')}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="storage-crumb">
            <span className="muted">›</span>
            {i === crumbs.length - 1 ? (
              <span className="mono">{crumb.label}</span>
            ) : (
              <button className="link mono" onClick={() => go({ ...location, path: crumb.path })}>
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="storage-toolbar">
        <button
          className="tool"
          title={t('上级目录')}
          onClick={() => (location.path === location.base ? go(null) : go({ ...location, path: parentOf(location.path) }))}
        >
          ↑ {t('上级')}
        </button>
        <button className="tool" disabled={loading} onClick={() => void load(location.path, asRoot, true)}>
          {t('重新统计')}
        </button>
        <button className="tool" title={t('新开一个 Shell 标签并进入这个目录')} onClick={() => openInTerminal(serial, location.path, asRoot)}>
          {t('在终端中打开')}
        </button>
        <span className="spacer" />
        <PathField onGo={(path) => go(path.startsWith(location.base) ? { ...location, path } : { base: path, path })} />
        {usage && (
          <span className="muted mono">
            {t('合计 {size}', { size: formatKB(usage.totalKB) })}
            {usage.root && ' · root'}
          </span>
        )}
      </div>
      {usage?.partial && !usage.root && (
        <p className="hint storage-hint">
          {t('部分目录没有读取权限，统计结果偏小。')}
          {canRoot ? (
            <button className="link" onClick={useRoot}>
              {t('用 root 重新统计')}
            </button>
          ) : (
            t('设备没有 root，无法读取。')
          )}
        </p>
      )}
      {error && (
        <p className="error">
          {error}
          {!asRoot && canRoot && (
            <button className="link" onClick={useRoot}>
              {t('用 root 重试')}
            </button>
          )}
        </p>
      )}
      {loading && <p className="muted">{t('正在统计 {dir} …（文件多的目录可能要几十秒）', { dir: location.path })}</p>}
      {usage && usage.entries.length === 0 && <p className="muted">{usage.partial ? t('没有读取权限，看不到这个目录里的内容') : t('空目录')}</p>}
      {usage && usage.entries.length > 0 && (
        <ul className="storage-entries">
          {usage.entries.map((entry) => {
            const path = joinPath(location.path, entry.name)
            const percent = max ? (entry.sizeKB / max) * 100 : 0
            const share = usage.totalKB ? (entry.sizeKB / usage.totalKB) * 100 : 0
            return (
              <li key={entry.name} className={`storage-entry${entry.dir ? ' is-dir' : ''}`}>
                <button
                  className="storage-entry-main"
                  disabled={!entry.dir}
                  title={entry.dir ? t('进入 {path}', { path }) : path}
                  onClick={() => entry.dir && go({ ...location, path })}
                >
                  <span className="storage-entry-name mono">
                    {entry.dir ? '📁' : '📄'} {entry.name}
                  </span>
                  <span className="storage-entry-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span className="storage-entry-size mono">{formatKB(entry.sizeKB)}</span>
                  <span className="storage-entry-share mono muted">{share >= 0.1 ? `${share.toFixed(1)}%` : ''}</span>
                </button>
                {entry.dir && (
                  <button className="tool storage-entry-term" title={t('在终端中打开 {path}', { path })} onClick={() => openInTerminal(serial, path, asRoot)}>
                    &gt;_
                  </button>
                )}
                {!entry.dir && <span className="storage-entry-term-spacer" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
