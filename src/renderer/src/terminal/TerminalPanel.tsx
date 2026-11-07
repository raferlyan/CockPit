import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { useTerminalStore, type TerminalTab } from './terminalStore'
import { activeTabId, visibleTabs } from './tabScope'
import { TerminalView } from './TerminalView'
import { SerialDialog } from './SerialDialog'
import { CollapseButton } from '../settings/ToolStripe'
import { LogcatFilterBar } from './LogcatFilterBar'
import { t } from '../i18n'
import { api } from '../api'

/** Windows 上是 PowerShell，其它系统是登录 shell */
const LOCAL_LABEL = () => (api.platform === 'win32' ? 'PowerShell' : t('本机终端'))

const LOGCAT_PLACEHOLDER = () => t('可选启动参数，如 -b crash 或 -s ActivityManager；打开后还可在筛选栏里过滤')

export function TerminalPanel() {
  const { tabs, activeBy, open, openSerial, close, reopen, activate } = useTerminalStore()
  const devices = useAppStore((s) => s.devices)
  const focused = useAppStore((s) => s.devices.find((d) => d.serial === s.focusedSerial))
  const canOpen = focused?.state === 'device'
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  // 所有标签都保持挂载，其它设备的终端继续运行；这里只决定显示哪些
  const shownTabs = useMemo(() => visibleTabs(tabs, focusedSerial), [tabs, focusedSerial])
  const activeId = activeTabId(tabs, focusedSerial, activeBy)
  const noDeviceReason = !canOpen && (focused ? t('当前设备不在线，无法打开 adb 终端') : t('先在左侧选择一台在线设备'))
  const [logcatArgs, setLogcatArgs] = useState<string | null>(null)
  const [serialOpen, setSerialOpen] = useState(false)
  const tabListRef = useRef<HTMLDivElement>(null)

  // 标签放不下时，当前标签要滚进可视区；滚动条隐藏了，普通滚轮也能横向滚
  useEffect(() => {
    // 不用 scrollIntoView：它还会滚动 overflow: hidden 的外层，把 + 和箭头带跑
    const list = tabListRef.current
    const tab = list?.querySelector('.terminal-tab.active')
    if (!list || !tab) return
    const box = list.getBoundingClientRect()
    const rect = tab.getBoundingClientRect()
    if (rect.left < box.left) list.scrollLeft -= box.left - rect.left
    else if (rect.right > box.right) list.scrollLeft += rect.right - box.right
    // $ / # 标记要等 shell 输出提示符后才出现，标签会变宽，所以也要跟着 identity 重算
  }, [activeId, shownTabs.length, tabs.find((tab) => tab.id === activeId)?.identity])

  const titleOf = (tab: TerminalTab) => {
    if (tab.port) return `${t('串口')} ${tab.port.path.split(/[\\/]/).pop()} · ${tab.port.baudRate}`
    if (tab.kind === 'local') return LOCAL_LABEL()
    // 标签只在所属设备下显示，不用再重复设备名
    return tab.root ? 'root shell' : tab.kind
  }
  const tooltipOf = (tab: TerminalTab) => {
    if (tab.port) return tab.port.path
    if (tab.kind === 'local') return t('本机终端，可以直接使用 adb')
    const device = devices.find((d) => d.serial === tab.serial)
    return [device && deviceTitle(device), `${t('序列号')} ${tab.serial}`, tab.logcatArgs && `logcat ${tab.logcatArgs}`].filter(Boolean).join('\n')
  }
  const active = tabs.find((t) => t.id === activeId)

  const submitLogcat = () => {
    if (focused) void open(focused.serial, 'logcat', logcatArgs ?? '')
    setLogcatArgs(null)
  }

  return (
    <section className="terminal-area">
      <div className="terminal-tabs">
        <div
          ref={tabListRef}
          className="terminal-tab-list"
          onWheel={(e) => {
            if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
          {shownTabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab${tab.id === activeId ? ' active' : ''}${tab.exit ? ' exited' : ''}`}
              onClick={() => activate(tab.id)}
              title={tooltipOf(tab)}
            >
              <span className="terminal-tab-title">{titleOf(tab)}</span>
              {tab.kind === 'shell' && <IdentityMark tab={tab} />}
              <button
                className="terminal-tab-close"
                title={t('关闭')}
                onClick={(e) => {
                  e.stopPropagation()
                  close(tab.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <NewTerminalButtons
          noDeviceReason={noDeviceReason}
          deviceLabel={focused ? deviceTitle(focused) : ''}
          onShell={() => focused && void open(focused.serial, 'shell')}
          onLogcat={() => setLogcatArgs('')}
          onLocal={() => void open('', 'local')}
          onSerial={() => setSerialOpen(true)}
        />
        <div className="spacer" />
        {logcatArgs !== null && (
          <form
            className="logcat-form"
            onSubmit={(e) => {
              e.preventDefault()
              submitLogcat()
            }}
          >
            <input
              autoFocus
              className="mono"
              value={logcatArgs}
              placeholder={LOGCAT_PLACEHOLDER()}
              onChange={(e) => setLogcatArgs(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setLogcatArgs(null)}
            />
            <button type="submit" className="tool">
              {t('打开')}
            </button>
            <button type="button" className="tool" onClick={() => setLogcatArgs(null)}>
              {t('取消')}
            </button>
          </form>
        )}
        <CollapseButton pane="terminal" />
      </div>
      {active?.kind === 'logcat' && <LogcatFilterBar key={active.id} tab={active} />}
      <div className="terminal-body">
        {tabs.map((tab) => (
          <TerminalView key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
        {shownTabs.length === 0 && (
          <div className="placeholder terminal-empty">
            {canOpen
              ? t('点击上方的 + 打开设备 Shell，下拉箭头里可以选 Logcat、{local}和串口；输入命令时会给出补全提示，可把文件拖进来插入其绝对路径', { local: LOCAL_LABEL() })
              : t('选择一台在线设备后可打开 adb 终端；下拉箭头里的 {local}和串口不需要设备在线', { local: LOCAL_LABEL() })}
          </div>
        )}
        {active?.exit && (
          <button className="secondary terminal-reopen" onClick={() => void reopen(active.id)}>
            {t('重新连接')}
          </button>
        )}
      </div>
      {serialOpen && (
        <SerialDialog
          onCancel={() => setSerialOpen(false)}
          onOpen={async (options) => {
            const ok = await openSerial(options)
            if (ok) setSerialOpen(false)
            return ok
          }}
        />
      )}
    </section>
  )
}

/** 新建终端：+ 直接开当前设备的 Shell，箭头展开全部类型 */
function NewTerminalButtons({
  noDeviceReason,
  deviceLabel,
  onShell,
  onLogcat,
  onLocal,
  onSerial
}: {
  noDeviceReason: string | false
  deviceLabel: string
  onShell(): void
  onLogcat(): void
  onLocal(): void
  onSerial(): void
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const arrowRef = useRef<HTMLButtonElement>(null)
  return (
    <span className="terminal-new" data-tour="terminal-actions">
      <ActionButton className="terminal-new-button" disabledReason={noDeviceReason} title={t('新建 Shell：{device}', { device: deviceLabel })} aria-label={t('新建 Shell')} onClick={onShell}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </ActionButton>
      <button
        ref={arrowRef}
        className={`terminal-new-button${anchor ? ' on' : ''}`}
        title={t('选择要打开的终端')}
        aria-label={t('选择要打开的终端')}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {anchor && (
        <NewTerminalMenu
          anchor={anchor}
          arrow={arrowRef}
          noDeviceReason={noDeviceReason}
          deviceLabel={deviceLabel}
          onClose={() => setAnchor(null)}
          actions={{ onShell, onLogcat, onLocal, onSerial }}
        />
      )}
    </span>
  )
}

function NewTerminalMenu({
  anchor,
  arrow,
  noDeviceReason,
  deviceLabel,
  onClose,
  actions
}: {
  anchor: DOMRect
  arrow: RefObject<HTMLButtonElement | null>
  noDeviceReason: string | false
  deviceLabel: string
  onClose(): void
  actions: { onShell(): void; onLogcat(): void; onLocal(): void; onSerial(): void }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 2 })

  // 终端在窗口底部，下面放不下时往上翻；右边放不下时往回收
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect()
    const below = anchor.bottom + 2 + rect.height <= window.innerHeight - 8
    setPos({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8)),
      top: below ? anchor.bottom + 2 : Math.max(8, anchor.top - rect.height - 2)
    })
    ref.current!.querySelector('button')?.focus()
  }, [anchor])

  useEffect(() => {
    // 捕获阶段监听：xterm 可能拦下鼠标事件。点箭头本身交给它的 onClick 收起，否则会关了又开
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !arrow.current?.contains(target)) onClose()
    }
    const onBlur = () => onClose()
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [arrow, onClose])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      arrow.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...ref.current!.querySelectorAll('button')]
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(items.indexOf(document.activeElement as HTMLButtonElement) + step + items.length) % items.length]?.focus()
  }

  const run = (action: () => void) => () => {
    onClose()
    action()
  }

  return (
    <div ref={ref} className="context-menu terminal-new-menu" style={pos} role="menu" onKeyDown={onKeyDown}>
      <ActionButton role="menuitem" disabledReason={noDeviceReason} onClick={run(actions.onShell)}>
        Shell
        {deviceLabel && <kbd>{deviceLabel}</kbd>}
      </ActionButton>
      <ActionButton role="menuitem" disabledReason={noDeviceReason} onClick={run(actions.onLogcat)}>
        Logcat…
        {deviceLabel && <kbd>{deviceLabel}</kbd>}
      </ActionButton>
      <hr />
      <button role="menuitem" title={t('本机终端，可以直接使用 adb')} onClick={run(actions.onLocal)}>
        {LOCAL_LABEL()}
      </button>
      <button role="menuitem" onClick={run(actions.onSerial)}>
        {t('串口')}…
      </button>
    </div>
  )
}

function IdentityMark({ tab }: { tab: TerminalTab }) {
  if (tab.exit || tab.identity === 'unknown') return null
  return tab.identity === 'root' ? (
    <span className="identity root" title={t('当前为 root 身份')}>
      #
    </span>
  ) : (
    <span className="identity" title={t('当前为普通用户')}>
      $
    </span>
  )
}
