import { useState } from 'react'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { useTerminalStore, type TerminalTab } from './terminalStore'
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
  const { tabs, activeId, open, openSerial, close, reopen, activate } = useTerminalStore()
  const devices = useAppStore((s) => s.devices)
  const focused = useAppStore((s) => s.devices.find((d) => d.serial === s.focusedSerial))
  const canOpen = focused?.state === 'device'
  const noDeviceReason = !canOpen && (focused ? t('当前设备不在线，无法打开 adb 终端') : t('先在左侧选择一台在线设备'))
  const [logcatArgs, setLogcatArgs] = useState<string | null>(null)
  const [serialOpen, setSerialOpen] = useState(false)

  const titleOf = (tab: TerminalTab) => {
    if (tab.port) return `${t('串口')} ${tab.port.path.split(/[\\/]/).pop()} · ${tab.port.baudRate}`
    if (tab.kind === 'local') return LOCAL_LABEL()
    const device = devices.find((d) => d.serial === tab.serial)
    return `${device ? deviceTitle(device) : tab.serial} · ${tab.root ? 'root shell' : tab.kind}`
  }
  const tooltipOf = (tab: TerminalTab) => {
    if (tab.port) return tab.port.path
    if (tab.kind === 'local') return t('本机终端，可以直接使用 adb')
    return [`${t('序列号')} ${tab.serial}`, tab.logcatArgs && `logcat ${tab.logcatArgs}`].filter(Boolean).join('\n')
  }
  const active = tabs.find((t) => t.id === activeId)

  const submitLogcat = () => {
    if (focused) void open(focused.serial, 'logcat', logcatArgs ?? '')
    setLogcatArgs(null)
  }

  return (
    <section className="terminal-area">
      <div className="terminal-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab${tab.id === activeId ? ' active' : ''}${tab.exit ? ' exited' : ''}`}
            onClick={() => activate(tab.id)}
            title={tooltipOf(tab)}
          >
            <span className="terminal-tab-title">{titleOf(tab)}</span>
            {tab.serial && <span className="terminal-tab-serial mono">{tab.serial}</span>}
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
        <div className="spacer" />
        {logcatArgs !== null ? (
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
        ) : (
          <span className="terminal-actions" data-tour="terminal-actions">
            <ActionButton className="tool" disabledReason={noDeviceReason} onClick={() => focused && void open(focused.serial, 'shell')}>
              + Shell
            </ActionButton>
            <ActionButton className="tool" disabledReason={noDeviceReason} onClick={() => setLogcatArgs('')}>
              + Logcat
            </ActionButton>
            <button className="tool" title={t('本机终端，可以直接使用 adb')} onClick={() => void open('', 'local')}>
              + {LOCAL_LABEL()}
            </button>
            <button className="tool" onClick={() => setSerialOpen(true)}>
              + {t('串口')}
            </button>
          </span>
        )}
        <CollapseButton pane="terminal" />
      </div>
      {active?.kind === 'logcat' && <LogcatFilterBar key={active.id} tab={active} />}
      <div className="terminal-body">
        {tabs.map((tab) => (
          <TerminalView key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
        {tabs.length === 0 && (
          <div className="placeholder terminal-empty">
            {canOpen
              ? t('点击右上角「+ Shell」打开设备终端，或「+ 串口」连接调试串口；输入命令时会给出补全提示，可把文件拖进来插入其绝对路径')
              : t('选择一台在线设备后可打开 adb 终端；串口不需要设备在线')}
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
