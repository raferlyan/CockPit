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

export function App() {
  useGlobalErrorToasts()
  useEffect(() => connectStore(), [])
  useEffect(() => connectTerminals(), [])
  useEffect(() => connectMetrics(), [])
  useEffect(() => connectTheme(), [])
  usePreventFileNavigation()
  // 默认中间显示设备状态；有投屏窗格时投屏占中间，状态挪到右侧
  const mirroring = useAppStore((s) => s.mirrorTiles.length > 0)
  const transfer = useFileStore((s) => s.transfer !== null)

  return (
    <div className="app">
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
      </main>
      <AdbStatusBar />
      {transfer && <FileTransferDialog />}
      <Toaster />
    </div>
  )
}
