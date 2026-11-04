import { useRef, type PointerEvent } from 'react'
import { DEFAULT_PANES, useSettingsStore, type PaneSizes } from './settingsStore'
import { t } from '../i18n'

interface SplitterProps {
  pane: keyof PaneSizes
  /** vertical：左右拖动的竖条；horizontal：上下拖动的横条 */
  orientation: 'vertical' | 'horizontal'
  /** 往右 / 往下拖时尺寸是变大（1）还是变小（-1） */
  direction: 1 | -1
  className: string
  /** 尺寸不超过父容器宽 / 高的这个比例，与 CSS 里的 min() 一致，避免拖过头后出现“拖不动”的死区 */
  maxRatio: number
}

/**
 * 区域之间的拖动条。拖动时直接改设置里的尺寸（CSS 变量），双击恢复默认。
 * 页面缩放后 clientX/Y 仍是 CSS 像素，与尺寸单位一致。
 */
export function Splitter({ pane, orientation, direction, className, maxRatio }: SplitterProps) {
  const start = useRef<{ pos: number; size: number; max: number } | null>(null)
  const vertical = orientation === 'vertical'

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const parent = e.currentTarget.parentElement!
    const max = (vertical ? parent.clientWidth : parent.clientHeight) * maxRatio
    // 从 CSS 实际生效的尺寸开始拖，保存值可能比当前窗口允许的更大
    start.current = { pos: vertical ? e.clientX : e.clientY, size: Math.min(useSettingsStore.getState().panes[pane], max), max }
    document.body.classList.add(vertical ? 'resizing-col' : 'resizing-row')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const delta = (vertical ? e.clientX : e.clientY) - start.current.pos
    useSettingsStore.getState().setPane(pane, Math.min(start.current.size + delta * direction, start.current.max))
  }
  const onPointerUp = () => {
    start.current = null
    document.body.classList.remove('resizing-col', 'resizing-row')
  }

  return (
    <div
      className={`splitter splitter-${orientation} ${className}`}
      role="separator"
      aria-orientation={orientation}
      title={t('拖动调整大小，双击恢复默认')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => useSettingsStore.getState().setPane(pane, DEFAULT_PANES[pane])}
    />
  )
}
