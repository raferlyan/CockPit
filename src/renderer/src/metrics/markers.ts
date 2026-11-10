import { useEffect } from 'react'
import type { AlertRuleId } from '@shared/alerts'
import type { MetricsMarker } from '@shared/metrics'
import { api } from '../api'
import { t } from '../i18n'
import { thermalStatusLabel } from './thresholds'

/** 告警规则的名称 */
export function alertRuleLabel(rule: string): string {
  const labels: Record<AlertRuleId, string> = {
    cpuTemp: t('CPU 温度过高'),
    thermalStatus: t('温控等级升高'),
    memoryAvailable: t('可用内存不足'),
    throttle: t('CPU 被限频'),
    jank: t('前台应用卡顿'),
    frameMs: t('单帧耗时过长')
  }
  return labels[rule as AlertRuleId] ?? rule
}

/** 告警标记的读数：温控等级换成名称，其余原样 */
export function alertValue(m: MetricsMarker): string {
  if (m.label === 'thermalStatus' && m.detail && /^\d+$/.test(m.detail)) return thermalStatusLabel(Number(m.detail))
  return m.detail ?? ''
}

/** 标记的显示文字：主进程只给主体，前缀在这里按类型拼上并翻译 */
export function markerText(m: MetricsMarker): string {
  switch (m.kind) {
    case 'input':
    case 'operation':
      return t(m.label)
    case 'foreground':
      return t('切换到 {name}', { name: m.label })
    case 'process':
      return t(m.action === 'start' ? '进程启动 {name}' : '进程结束 {name}', { name: m.label })
    case 'crash':
      return t('崩溃 {name}', { name: m.label })
    case 'anr':
      return t('ANR {name}', { name: m.label })
    case 'lmk':
      return t('低内存查杀 {name}', { name: m.label })
    case 'jank':
      return t('卡顿 {ms} ms', { ms: m.label })
    case 'manual':
      return m.label ? t('标记：{note}', { note: m.label }) : t('手动标记')
    case 'alert':
      return m.resolved ? t('已恢复：{rule}', { rule: alertRuleLabel(m.label) }) : t('{rule}：{value}', { rule: alertRuleLabel(m.label), value: alertValue(m) })
  }
}

/** 严重的事件用醒目的颜色，日常的输入和切换用灰色，免得满屏都是红线 */
export function markerTone(m: MetricsMarker): 'dim' | 'accent' | 'warn' | 'err' {
  switch (m.kind) {
    case 'alert':
      return m.resolved ? 'dim' : 'warn'
    case 'crash':
    case 'anr':
      return 'err'
    case 'lmk':
    case 'jank':
      return 'warn'
    case 'manual':
    case 'operation':
      return 'accent'
    default:
      return 'dim'
  }
}

/** 组件挂载期间告诉主进程“有人在看这台设备的帧率”，卸载时撤销 */
export function useFramesDemand(serial: string | undefined): void {
  useEffect(() => {
    if (!serial) return
    api.metrics.watchFrames(serial, true)
    return () => api.metrics.watchFrames(serial, false)
  }, [serial])
}

/** 手动打标记的快捷键文字，界面提示用 */
export const MARKER_SHORTCUT = api.platform === 'darwin' ? '⌘⇧M' : 'Ctrl+Shift+M'

/**
 * ⌘⇧M / Ctrl+Shift+M 给当前设备打一个手动标记（⌘M 是 macOS 的最小化窗口）。
 * 在捕获阶段处理并阻止传播：焦点在投屏画面上时也能用，按键不会转发给设备。
 */
export function useMarkerShortcut(serial: () => string | null | undefined): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod || e.altKey || !e.shiftKey || e.key.toLowerCase() !== 'm') return
      const target = serial()
      if (!target) return
      e.preventDefault()
      e.stopPropagation()
      void api.metrics.addMarker(target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [serial])
}
