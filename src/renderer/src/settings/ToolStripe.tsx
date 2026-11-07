import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '../store'
import { useTerminalStore } from '../terminal/terminalStore'
import { visibleTabs } from '../terminal/tabScope'
import { useSettingsStore, type PaneSizes } from './settingsStore'
import { t } from '../i18n'

type Pane = keyof PaneSizes

const isMac = window.cockpit.platform === 'darwin'
const MOD = isMac ? '⌘' : 'Ctrl+'

/** 与 Android Studio 的 ⌘1 / ⌘F12 思路一致：数字键切换单个区域，⇧F12 一键收起全部 */
const SHORTCUT_KEYS: Record<Pane, string> = { sidebar: '1', side: '2', terminal: '3' }
export const HIDE_ALL_SHORTCUT = isMac ? '⌘⇧F12' : 'Ctrl+Shift+F12'

export const PANE_LABEL = (): Record<Pane, string> => ({ sidebar: t('设备列表'), side: t('设备信息'), terminal: t('终端') })

export function paneShortcut(pane: Pane): string {
  return `${MOD}${SHORTCUT_KEYS[pane]}`
}

const ICONS: Record<Pane, ReactNode> = {
  sidebar: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
      <path d="M7 12.5h2" />
    </svg>
  ),
  side: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4.5M8 4.5v.5" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
    </svg>
  )
}

/** 区域标题栏右侧的「收起」按钮 */
export function CollapseButton({ pane }: { pane: Pane }) {
  const arrow = pane === 'sidebar' ? '‹' : pane === 'side' ? '›' : '⌄'
  return (
    <button
      className="collapse-button"
      data-tour={`collapse-${pane}`}
      title={t('收起{name}（{key}）', { name: PANE_LABEL()[pane], key: paneShortcut(pane) })}
      aria-label={t('收起{name}', { name: PANE_LABEL()[pane] })}
      onClick={() => useSettingsStore.getState().toggleCollapsed(pane, true)}
    >
      {arrow}
    </button>
  )
}

/**
 * 区域收起后留在窗口边缘的图标条，点击展开。
 * 左右两侧是竖条（文字竖排），终端是底部横条。
 */
export function ToolStripe({ pane }: { pane: Pane }) {
  const badge = useStripeBadge(pane)
  const vertical = pane !== 'terminal'
  return (
    <div className={`tool-stripe tool-stripe-${pane}${vertical ? ' vertical' : ''}`}>
      <button
        className="tool-stripe-button"
        title={t('展开{name}（{key}）', { name: PANE_LABEL()[pane], key: paneShortcut(pane) })}
        onClick={() => useSettingsStore.getState().toggleCollapsed(pane, false)}
      >
        {ICONS[pane]}
        <span className="tool-stripe-label">{PANE_LABEL()[pane]}</span>
        {badge !== null && <span className="tool-stripe-badge">{badge}</span>}
      </button>
    </div>
  )
}

/** 图标旁的数字：在线设备数、终端标签数 */
function useStripeBadge(pane: Pane): number | null {
  const online = useAppStore((s) => s.devices.filter((d) => d.state === 'device').length)
  // 只算当前设备下能看到的标签
  const focused = useAppStore((s) => s.focusedSerial)
  const tabs = useTerminalStore((s) => visibleTabs(s.tabs, focused).length)
  if (pane === 'sidebar') return online || null
  if (pane === 'terminal') return tabs || null
  return null
}

/** 全局快捷键；捕获阶段处理，避免终端（xterm）先把按键吃掉 */
export function useToolWindowShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return
      const store = useSettingsStore.getState()
      if (e.shiftKey && e.key === 'F12') {
        store.toggleAllCollapsed()
      } else if (!e.shiftKey) {
        const pane = (Object.keys(SHORTCUT_KEYS) as Pane[]).find((p) => SHORTCUT_KEYS[p] === e.key)
        if (!pane) return
        store.toggleCollapsed(pane)
      } else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
