import { useAppStore } from '../store'
import { ThemeSwitch } from '../theme/ThemeSwitch'
import { useUiStore } from '../settings/uiStore'

function SettingsButton() {
  return (
    <button className="statusbar-button" title="字号、字体、布局与使用向导" onClick={() => useUiStore.getState().setSettingsOpen(true)}>
      ⚙ 设置
    </button>
  )
}

export function AdbStatusBar() {
  const status = useAppStore((s) => s.adbStatus)
  const onlineCount = useAppStore((s) => s.devices.filter((d) => d.state === 'device').length)

  if (!status)
    return (
      <footer className="statusbar">
        正在连接 adb…
        <span className="spacer" />
        <ThemeSwitch />
        <SettingsButton />
      </footer>
    )

  return (
    <footer className="statusbar">
      <span className={`dot state-${status.tracking ? 'ok' : 'err'}`} />
      <span>{status.tracking ? `adb ${status.version ?? ''}` : (status.error ?? 'adb 未连接')}</span>
      {status.path && (
        <span className="mono muted" title={status.path}>
          {status.path}
        </span>
      )}
      <span className="spacer" />
      <span>{onlineCount} 台在线</span>
      <ThemeSwitch />
      <SettingsButton />
    </footer>
  )
}
