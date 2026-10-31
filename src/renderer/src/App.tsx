import { useEffect } from 'react'
import { connectStore } from './store'
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

export function App() {
  useGlobalErrorToasts()
  useEffect(() => connectStore(), [])
  useEffect(() => connectTerminals(), [])
  useEffect(() => connectMetrics(), [])

  return (
    <div className="app">
      <ErrorBoundary name="设备列表" className="sidebar">
        <DeviceList />
      </ErrorBoundary>
      <main className="workspace">
        <ErrorBoundary name="投屏区" className="mirror-area">
          <MirrorGrid />
        </ErrorBoundary>
        <aside className="side-panels">
          <ErrorBoundary name="设备信息" className="panel">
            <DeviceDetail />
          </ErrorBoundary>
          <ErrorBoundary name="设备状态" className="panel">
            <StatusPanel />
          </ErrorBoundary>
        </aside>
        <ErrorBoundary name="终端" className="terminal-area">
          <TerminalPanel />
        </ErrorBoundary>
      </main>
      <AdbStatusBar />
      <Toaster />
    </div>
  )
}
