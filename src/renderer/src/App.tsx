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
import { ToolStripe, useToolWindowShortcuts } from './settings/ToolStripe'
import { SettingsDialog } from './settings/SettingsDialog'
import { RootSettingsDialog } from './root/RootSettingsDialog'
import { GuideTour } from './settings/GuideTour'
import { AppManagerDialog } from './apps/AppManagerDialog'
import { TraceView } from './trace/TraceView'
import { RecordTraceDialog } from './trace/RecordTraceDialog'
import { connectTraces, useTraceStore } from './trace/traceStore'
import { ScreenshotDialog } from './apps/ScreenshotDialog'
import { LoggerExportDialog } from './files/LoggerExportDialog'
import { useScreenshotStore } from './apps/screenshot'
import { t, useLanguage } from './i18n'
import { api } from './api'

/** 收起后图标条的宽（左右）或高（底部），像素 */
const STRIPE_SIZE = 28

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
  useEffect(() => connectTraces(), [])
  usePreventFileNavigation()
  // 订阅语言：切换时整棵树重渲染（不卸载），主进程的对话框和错误信息也跟着切换
  const language = useLanguage()
  useEffect(() => {
    api.app.setLanguage(language)
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  }, [language])
  useZoomShortcuts()
  useToolWindowShortcuts()
  const panes = useSettingsStore((s) => s.panes)
  const collapsed = useSettingsStore((s) => s.collapsed)
  const { settingsOpen, guideOpen, appsSerial, loggerSerial, traceOpen, rootSettings } = useUiStore()
  // 默认中间显示设备状态；有投屏窗格时投屏占中间，状态挪到右侧
  const mirroring = useAppStore((s) => s.mirrorTiles.length > 0)
  // Perfetto 打开时占中间；投屏窗格只是隐藏，会话不断，收起后原样回来
  const statusAside = mirroring || traceOpen
  const transfer = useFileStore((s) => s.transfer !== null)
  const traceDialogSerial = useTraceStore((s) => s.dialogSerial)
  const shot = useScreenshotStore((s) => s.shot)

  // 收起的区域只占一条图标条；尺寸变量换成图标条的宽 / 高，网格和拖动条位置都跟着变
  const size = (pane: keyof typeof panes, stripe: number) => `${collapsed[pane] ? stripe : panes[pane]}px`

  return (
    <div
      className="app"
      style={{
        ['--sidebar-w' as string]: size('sidebar', STRIPE_SIZE),
        ['--side-w' as string]: size('side', STRIPE_SIZE),
        ['--term-h' as string]: size('terminal', STRIPE_SIZE)
      }}
    >
      {collapsed.sidebar ? (
        <ToolStripe pane="sidebar" />
      ) : (
        <ErrorBoundary name={t('设备列表')} className="sidebar">
          <DeviceList />
        </ErrorBoundary>
      )}
      <main className={`workspace${collapsed.terminal ? ' terminal-collapsed' : ''}`}>
        {traceOpen && (
          <ErrorBoundary name="Perfetto" className="trace-area">
            <TraceView />
          </ErrorBoundary>
        )}
        {mirroring ? (
          <div className={traceOpen ? 'is-hidden' : 'contents'}>
            <ErrorBoundary name={t('投屏区')} className="mirror-area">
              <MirrorGrid />
            </ErrorBoundary>
          </div>
        ) : (
          !traceOpen && (
            <ErrorBoundary name={t('设备状态')} className="panel center-status">
              <StatusPanel wide />
            </ErrorBoundary>
          )
        )}
        {collapsed.side ? (
          <ToolStripe pane="side" />
        ) : (
          <aside className="side-panels">
            <ErrorBoundary name={t('设备信息')} className="panel">
              <DeviceDetail />
            </ErrorBoundary>
            {statusAside && (
              <ErrorBoundary name={t('设备状态')} className="panel">
                <StatusPanel />
              </ErrorBoundary>
            )}
          </aside>
        )}
        {/* 终端收起时只隐藏不卸载，保留各标签的会话和滚动记录 */}
        <ErrorBoundary name={t('终端')} className="terminal-area">
          <TerminalPanel />
        </ErrorBoundary>
        {collapsed.terminal && <ToolStripe pane="terminal" />}
        {!collapsed.side && <Splitter pane="side" orientation="vertical" direction={-1} className="splitter-side" maxRatio={0.6} />}
        {!collapsed.terminal && (
          <Splitter pane="terminal" orientation="horizontal" direction={-1} className="splitter-terminal" maxRatio={0.75} />
        )}
      </main>
      {!collapsed.sidebar && <Splitter pane="sidebar" orientation="vertical" direction={1} className="splitter-sidebar" maxRatio={0.35} />}
      <AdbStatusBar />
      {transfer && <FileTransferDialog />}
      {appsSerial && <AppManagerDialog serial={appsSerial} />}
      {loggerSerial && <LoggerExportDialog serial={loggerSerial} />}
      {traceDialogSerial && <RecordTraceDialog serial={traceDialogSerial} />}
      {shot && <ScreenshotDialog shot={shot} />}
      {settingsOpen && <SettingsDialog />}
      {rootSettings && <RootSettingsDialog serial={rootSettings.serial} />}
      {guideOpen && <GuideTour />}
      <Toaster />
    </div>
  )
}
