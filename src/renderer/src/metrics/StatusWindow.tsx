import { useEffect, useMemo } from 'react'
import { connectStore, useAppStore } from '../store'
import { connectMetrics } from './metricsStore'
import { connectTheme } from '../theme/themeStore'
import { connectSettings } from '../settings/settingsStore'
import { StatusPanel } from './StatusPanel'
import { ErrorBoundary } from '../notify/ErrorBoundary'
import { Toaster, useGlobalErrorToasts } from '../notify/Toaster'
import { deviceTitle } from '../labels'
import { t, useLanguage } from '../i18n'
import { useMarkerShortcut } from './markers'

const focusedSerialNow = () => useAppStore.getState().focusedSerial

/**
 * 弹出的独立设备状态窗口（页面 hash 为 #status）。
 * 是一个独立的渲染进程：自己订阅设备与采集推送，选中的设备与主窗口互不影响。
 */
export function StatusWindow() {
  useGlobalErrorToasts()
  useEffect(() => connectStore(), [])
  useEffect(() => connectMetrics(), [])
  useEffect(() => connectTheme(), [])
  useEffect(() => connectSettings(), [])
  useMarkerShortcut(focusedSerialNow)
  const language = useLanguage()
  const devices = useAppStore((s) => s.devices)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const focus = useAppStore((s) => s.focus)
  const online = useMemo(() => devices.filter((d) => d.state === 'device'), [devices])
  const focused = devices.find((d) => d.serial === focusedSerial)

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  }, [language])
  useEffect(() => {
    document.title = focused ? `${t('设备状态')} · ${deviceTitle(focused)}` : t('设备状态')
  }, [focused, language])

  return (
    <div className="status-window">
      <header className="status-window-bar">
        <select value={focusedSerial ?? ''} onChange={(e) => focus(e.target.value || null)} disabled={!online.length}>
          {!online.length && <option value="">{t('没有在线设备')}</option>}
          {online.map((d) => (
            <option key={d.serial} value={d.serial}>
              {deviceTitle(d)} · {d.serial}
            </option>
          ))}
        </select>
      </header>
      <div className="status-window-body">
        <ErrorBoundary name={t('设备状态')} className="panel">
          <StatusPanel wide standalone />
        </ErrorBoundary>
      </div>
      <Toaster />
    </div>
  )
}
