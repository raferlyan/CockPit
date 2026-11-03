import { useEffect } from 'react'
import { connectStore, useAppStore } from './store'
import { MirrorGrid } from './mirror/MirrorGrid'
import { DeviceList } from './components/DeviceList'
import { DeviceDetail } from './components/DeviceDetail'
import { AdbStatusBar } from './components/AdbStatusBar'
import { TerminalPanel } from './terminal/TerminalPanel'
import { connectTerminals } from './terminal/terminalStore'
import { StatusPanel } from './metrics/StatusPanel'
import { connectMetrics } from './metrics/metricsStore'
import { ErrorBoundary } from './notify/ErrorBoundary'
import { Toaster, useGlobalErrorToasts } from './notify/Toaster'
import { connectTheme } from './theme/themeStore'
import { FileTransferDialog } from './files/FileTransferDialog'
import { useFileStore, usePreventFileNavigation } from './files/fileStore'
import { connectSettings, useSettingsStore } from './settings/settingsStore'
import { useUiStore } from './settings/uiStore'
import { Splitter } from './settings/Splitter'
import { SettingsDialog } from './settings/SettingsDialog'
import { GuideDialog } from './settings/GuideDialog'
import { AppManagerDialog } from './apps/AppManagerDialog'

/** Cmd/Ctrl + = / - / 0 调整整体字号 */
function useZoomShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(window.cockpit.platform === 'darwin' ? e.metaKey : e.ctrlKey) || e.altKey) return
      const { uiScale, update } = useSettingsStore.getState()
      const step = { '=': 0.05, '+': 0.05, '-': -0.05, _: -0.05 }[e.key]
      if (step) update({ uiScale: Math.round(Math.min(1.5, Math.max(0.8, uiScale + step)) * 100) / 100 })
      else if (e.key === '0') update({ uiScale: 1 })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  useGlobalErrorToasts()
  useEffect(() => connectStore(), [])
  useEffect(() => connectTerminals(), [])
  useEffect(() => connectMetrics(), [])
  useEffect(() => connectTheme(), [])
  useEffect(() => connectSettings(), [])
  usePreventFileNavigation()
  useZoomShortcuts()
  const panes = useSettingsStore((s) => s.panes)
  const { settingsOpen, guideOpen, appsSerial } = useUiStore()
  // 默认中间显示设备状态；有投屏窗格时投屏占中间，状态挪到右侧
  const mirroring = useAppStore((s) => s.mirrorTiles.length > 0)
  const transfer = useFileStore((s) => s.transfer !== null)

  return (
    <div
      className="app"
      style={{ ['--sidebar-w' as string]: `${panes.sidebar}px`, ['--side-w' as string]: `${panes.side}px`, ['--term-h' as string]: `${panes.terminal}px` }}
    >
      <ErrorBoundary name="设备列表" className="sidebar">
        <DeviceList />
      </ErrorBoundary>
      <main className="workspace">
        {mirroring ? (
          <ErrorBoundary name="投屏区" className="mirror-area">
            <MirrorGrid />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="设备状态" className="panel center-status">
            <StatusPanel wide />
          </ErrorBoundary>
        )}
        <aside className="side-panels">
          <ErrorBoundary name="设备信息" className="panel">
            <DeviceDetail />
          </ErrorBoundary>
          {mirroring && (
            <ErrorBoundary name="设备状态" className="panel">
              <StatusPanel />
            </ErrorBoundary>
          )}
        </aside>
        <ErrorBoundary name="终端" className="terminal-area">
          <TerminalPanel />
        </ErrorBoundary>
        <Splitter pane="side" orientation="vertical" direction={-1} className="splitter-side" maxRatio={0.6} />
        <Splitter pane="terminal" orientation="horizontal" direction={-1} className="splitter-terminal" maxRatio={0.75} />
      </main>
      <Splitter pane="sidebar" orientation="vertical" direction={1} className="splitter-sidebar" maxRatio={0.35} />
      <AdbStatusBar />
      {transfer && <FileTransferDialog />}
      {appsSerial && <AppManagerDialog serial={appsSerial} />}
      {settingsOpen && <SettingsDialog />}
      {guideOpen && <GuideDialog />}
      <Toaster />
    </div>
  )
}
