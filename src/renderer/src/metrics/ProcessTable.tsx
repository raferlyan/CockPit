import { useMemo, useState } from 'react'
import { create } from 'zustand'
import type { ProcessInfo } from '@shared/metrics'
import { formatKB } from './format'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'

type SortKey = 'cpu' | 'mem' | 'name'
const LIMITS = [10, 30, Infinity] as const

const PIN_KEY = 'cockpit.pinnedProcesses'

/** 固定的进程按名字记（pid 每次重启都会变），所有设备共用，存在本地 */
const usePinStore = create<{ pinned: string[]; toggle(name: string): void }>((set, get) => ({
  pinned: loadPinned(),
  toggle: (name) => {
    const pinned = get().pinned.includes(name) ? get().pinned.filter((n) => n !== name) : [...get().pinned, name]
    set({ pinned })
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(pinned))
    } catch {
      // 存不下时本次会话内仍然生效
    }
  }
}))

function loadPinned(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const COMPARE: Record<SortKey, (a: ProcessInfo, b: ProcessInfo) => number> = {
  cpu: (a, b) => b.cpu - a.cpu || b.resKB - a.resKB,
  mem: (a, b) => b.resKB - a.resKB || b.cpu - a.cpu,
  name: (a, b) => a.name.localeCompare(b.name) || a.pid - b.pid
}

/** 应用进程（包名形式，可带 :子进程）才能设为关注应用；内核线程、native 进程不行 */
function packageOf(name: string): string | undefined {
  const pkg = name.split(':')[0]
  return /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(pkg) ? pkg : undefined
}

interface ProcessTableProps {
  serial: string
  processes: ProcessInfo[]
  /** 当前关注的应用 */
  focusPkg?: string
  /** 前台应用，所在行高亮 */
  foregroundPkg?: string
}

/**
 * 进程表：按 CPU / 内存 / 名称排序，按名称或 PID 搜索，固定关心的进程置顶。
 * 固定的进程不受搜索和条数限制，没在运行时也留一行提示。应用进程可以一键设为关注应用。
 */
export function ProcessTable({ serial, processes, focusPkg, foregroundPkg }: ProcessTableProps) {
  const [sort, setSort] = useState<SortKey>('cpu')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(10)
  const { pinned, toggle } = usePinStore()

  const { pinnedRows, missing, rows, matched } = useMemo(() => {
    const sorted = [...processes].sort(COMPARE[sort])
    const pinnedSet = new Set(pinned)
    const pinnedRows = sorted.filter((p) => pinnedSet.has(p.name))
    const running = new Set(pinnedRows.map((p) => p.name))
    const q = query.trim().toLowerCase()
    const others = sorted.filter((p) => !pinnedSet.has(p.name) && (!q || p.name.toLowerCase().includes(q) || String(p.pid).startsWith(q)))
    return {
      pinnedRows,
      missing: pinned.filter((name) => !running.has(name)),
      rows: others.slice(0, limit),
      matched: others.length
    }
  }, [processes, sort, query, limit, pinned])

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button className={`sort-button${sort === key ? ' on' : ''}`} onClick={() => setSort(key)} title={t('按{label}排序', { label })}>
        {label}
        {sort === key && <span aria-hidden>{key === 'name' ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  )

  const focusOn = (pkg: string) =>
    void api.metrics.setFocusApp(serial, pkg).catch((error) => notify('error', t('设置关注应用失败'), errorMessage(error)))

  const row = (p: ProcessInfo, isPinned: boolean) => {
    const pkg = packageOf(p.name)
    const classes = [isPinned && 'pinned', pkg && pkg === foregroundPkg && 'foreground'].filter(Boolean).join(' ')
    return (
      <tr key={p.pid} className={classes || undefined} title={`PID ${p.pid} · ${p.user}${pkg === foregroundPkg ? ` · ${t('前台应用')}` : ''}`}>
        <td className="pin-cell">
          <PinButton pinned={isPinned} onClick={() => toggle(p.name)} />
        </td>
        <td className="proc-name">
          {p.name}
          {pkg && (
            <button
              className={`focus-button${pkg === focusPkg ? ' on' : ''}`}
              onClick={() => focusOn(pkg)}
              title={pkg === focusPkg ? t('正在关注这个应用') : t('关注这个应用：采集它的 CPU、内存和线程')}
              disabled={pkg === focusPkg}
            >
              {pkg === focusPkg ? t('关注中') : t('关注')}
            </button>
          )}
        </td>
        <td className="num mono">{p.cpu.toFixed(1)}%</td>
        <td className="num mono">{p.resKB ? formatKB(p.resKB) : '—'}</td>
      </tr>
    )
  }

  return (
    <div className="process-table">
      <div className="process-toolbar">
        <input className="apps-search" placeholder={t('搜索进程名或 PID')} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <div className="segmented" title={t('显示条数')}>
          {LIMITS.map((n) => (
            <button key={n} className={limit === n ? 'on' : ''} onClick={() => setLimit(n)}>
              {n === Infinity ? t('全部') : n}
            </button>
          ))}
        </div>
      </div>
      <table className="proc-table">
        <thead>
          <tr>
            <th className="pin-cell" />
            {header('name', t('进程'))}
            {header('cpu', 'CPU', 'num')}
            {header('mem', t('内存'), 'num')}
          </tr>
        </thead>
        <tbody>
          {pinnedRows.map((p) => row(p, true))}
          {missing.map((name) => (
            <tr key={`missing:${name}`} className="pinned missing">
              <td className="pin-cell">
                <PinButton pinned onClick={() => toggle(name)} />
              </td>
              <td className="proc-name">{name}</td>
              <td className="num muted" colSpan={2}>
                {t('未运行')}
              </td>
            </tr>
          ))}
          {rows.map((p) => row(p, false))}
        </tbody>
      </table>
      <p className="muted process-count">
        {query.trim() ? t('匹配 {m} / 共 {n} 个进程', { m: matched, n: processes.length }) : t('共 {n} 个进程', { n: processes.length })}
      </p>
    </div>
  )
}

function PinButton({ pinned, onClick }: { pinned: boolean; onClick(): void }) {
  return (
    <button className={`pin-button${pinned ? ' on' : ''}`} onClick={onClick} title={pinned ? t('取消固定') : t('固定到顶部')} aria-pressed={pinned}>
      {pinned ? '★' : '☆'}
    </button>
  )
}
