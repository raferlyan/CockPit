import { useAppStore } from '../store'
import { ThemeSwitch } from '../theme/ThemeSwitch'
import { useUiStore } from '../settings/uiStore'
import { t } from '../i18n'
import { useOplogStore } from '../oplog/oplogStore'

function SettingsButton() {
  return (
    <button className="statusbar-button" data-tour="settings" title={t('字号、字体、语言、布局与使用向导')} onClick={() => useUiStore.getState().setSettingsOpen(true)}>
      ⚙ {t('设置')}
    </button>
  )
}

function PerfettoButton() {
  const open = useUiStore((s) => s.traceOpen)
  return (
    <button
      className={`statusbar-button${open ? ' on' : ''}`}
      data-tour="perfetto"
      title={t('在中间区域打开内嵌的 Perfetto，查看和分析 trace 文件')}
      onClick={() => useUiStore.getState().setTraceOpen(!open)}
    >
      Perfetto
    </button>
  )
}

function OplogButton() {
  const open = useUiStore((s) => s.oplogOpen)
  const unseen = useOplogStore((s) => s.unseen)
  return (
    <button
      className={`statusbar-button${open ? ' on' : ''}`}
      data-tour="oplog"
      title={t('查看每次操作执行的 adb 命令，可以复制使用')}
      onClick={() => useUiStore.getState().setOplogOpen(!open)}
    >
      {t('操作日志')}
      {unseen > 0 && !open && <span className="statusbar-badge">{unseen > 99 ? '99+' : unseen}</span>}
    </button>
  )
}

export function AdbStatusBar() {
  const status = useAppStore((s) => s.adbStatus)
  const onlineCount = useAppStore((s) => s.devices.filter((d) => d.state === 'device').length)

  if (!status)
    return (
      <footer className="statusbar">
        {t('正在连接 adb…')}
        <span className="spacer" />
        <OplogButton />
        <PerfettoButton />
        <ThemeSwitch />
        <SettingsButton />
      </footer>
    )

  return (
    <footer className="statusbar">
      <span className={`dot state-${status.tracking ? 'ok' : 'err'}`} />
      <span>{status.tracking ? `adb ${status.version ?? ''}` : (status.error ?? t('adb 未连接'))}</span>
      {status.path && (
        <span className="mono muted" title={status.path}>
          {status.path}
        </span>
      )}
      <span className="spacer" />
      <span>{t('{n} 台在线', { n: onlineCount })}</span>
      <OplogButton />
      <PerfettoButton />
      <ThemeSwitch />
      <SettingsButton />
    </footer>
  )
}
