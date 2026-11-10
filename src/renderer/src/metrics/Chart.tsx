import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { cssVar, useThemeStore } from '../theme/themeStore'
import type { MetricsMarker } from '@shared/metrics'
import { useTimelineStore } from './timelineStore'
import { markerText, markerTone } from './markers'

/** 状态面板里的曲线默认放在同一个联动组：悬停一张，其余几张同一时刻也显示竖线和数值 */
const DEFAULT_SYNC = 'status'
/** 拖选不足这么多像素视为误触，不放大 */
const MIN_SELECT_PX = 8

/** 分类色：深色面板上验证过色觉障碍区分度与对比度，按固定顺序分配，不循环 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70']

/** 坐标轴颜色取自当前主题的 CSS 变量，切换主题时重建图表 */
function axisStyle() {
  return { stroke: cssVar('--text-dim'), grid: { stroke: cssVar('--border'), width: 1 }, ticks: { show: false }, font: '10px -apple-system, sans-serif' }
}

export interface ChartSeries {
  label: string
  color: string
}

interface ChartProps {
  series: ChartSeries[]
  data: uPlot.AlignedData
  /** y 轴固定范围（如百分比 0–100），不传时自动 */
  range?: [number, number]
  unit: string
  height?: number
  /** 联动组名；传 null 不参与联动 */
  sync?: string | null
  /** 画成竖线的事件，悬停时显示说明 */
  markers?: MetricsMarker[]
}

/** 鼠标离标记竖线这么近（CSS 像素）时显示它的说明 */
const MARKER_HOVER_PX = 5
const TONE_VAR = { dim: '--text-dim', accent: '--accent', warn: '--warn', err: '--err' } as const

/**
 * uPlot 折线图。系列配置变化时重建实例，数据变化时只 setData。
 * 图例显示悬停处的数值，兼作 tooltip。
 * 横向拖选放大（写入 timelineStore，所有曲线一起放大），双击还原。
 */
export function Chart({ series, data, range, unit, height = 150, sync = DEFAULT_SYNC, markers }: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // 绘制钩子在 uPlot 实例里，通过 ref 读最新的标记，标记变化时不用重建图表
  const markersRef = useRef<MetricsMarker[]>([])
  markersRef.current = markers ?? []
  const seriesKey = series.map((s) => `${s.label}:${s.color}`).join('|') + (range?.join(',') ?? '')
  const theme = useThemeStore((s) => s.resolved)
  const zoom = useTimelineStore((s) => s.zoom)

  useEffect(() => {
    const host = hostRef.current!
    const AXIS = axisStyle()
    const format = (v: number | null) => (v == null ? '—' : `${v.toFixed(unit === '%' ? 0 : 1)}${unit}`)
    const plot = new uPlot(
      {
        width: host.clientWidth || 280,
        height,
        cursor: {
          y: false,
          points: { size: 8 },
          drag: { x: true, y: false, setScale: false },
          ...(sync ? { sync: { key: sync } } : {})
        },
        legend: { live: true },
        hooks: {
          // 不悬停时图例显示最新值
          setCursor: [
            (u) => {
              if (u.cursor.idx == null) showLatest(u)
              showMarkerTip(u, markersRef.current, tipRef.current)
            }
          ],
          draw: [(u) => drawMarkers(u, markersRef.current)],
          setSelect: [
            (u) => {
              const { left, width } = u.select
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
              if (width < MIN_SELECT_PX) return
              useTimelineStore.getState().setZoom([u.posToVal(left, 'x'), u.posToVal(left + width, 'x')])
            }
          ]
        },
        scales: { x: { time: true }, y: range ? { range: () => range } : { auto: true } },
        axes: [
          { ...AXIS, size: 24, space: 60, values: (_u, ticks) => ticks.map((t) => new Date(t * 1000).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })) },
          // 纵轴宽度按最长的刻度文字估算，“150 MB” 这类带单位的刻度不会被截掉
          { ...AXIS, size: (_u, values) => Math.max(36, Math.ceil(Math.max(0, ...(values ?? []).map((v) => v.length)) * 6.2) + 10), values: (_u, ticks) => ticks.map((t) => `${t}${unit}`) }
        ],
        series: [
          { value: (_u, v) => (v == null ? '' : new Date(v * 1000).toLocaleTimeString()) },
          ...series.map((s) => ({ label: s.label, stroke: s.color, width: 2, spanGaps: false, points: { show: false }, value: (_u: uPlot, v: number | null) => format(v) }))
        ]
      },
      data,
      host
    )
    plotRef.current = plot
    applyZoom(plot, useTimelineStore.getState().zoom)

    const onDoubleClick = () => useTimelineStore.getState().resetZoom()
    host.addEventListener('dblclick', onDoubleClick)
    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0) plot.setSize({ width: host.clientWidth, height })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      host.removeEventListener('dblclick', onDoubleClick)
      plot.destroy()
      plotRef.current = null
    }
    // data 走下面的 setData，不触发重建
  }, [seriesKey, unit, height, theme, sync])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    // 放大时保留当前 x 范围，否则 setData 会把它重置成全部数据
    const zoomed = useTimelineStore.getState().zoom
    plot.setData(data, !zoomed)
    if (zoomed) applyZoom(plot, zoomed)
    if (plot.cursor.idx == null) showLatest(plot)
  }, [data])

  useEffect(() => {
    const plot = plotRef.current
    if (plot) applyZoom(plot, zoom)
  }, [zoom])

  useEffect(() => {
    plotRef.current?.redraw(false, false)
  }, [markers])

  return (
    <div className="chart-wrap">
      <div ref={hostRef} className="chart" />
      <div ref={tipRef} className="chart-marker-tip" hidden />
    </div>
  )
}

/** 在绘图区画出范围内的标记竖线 */
function drawMarkers(u: uPlot, markers: MetricsMarker[]): void {
  if (!markers.length) return
  const { ctx } = u
  const { top, height } = u.bbox
  const min = u.scales.x.min ?? -Infinity
  const max = u.scales.x.max ?? Infinity
  ctx.save()
  ctx.lineWidth = Math.max(1, devicePixelRatio)
  ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio])
  for (const m of markers) {
    const x = m.t / 1000
    if (x < min || x > max) continue
    const px = Math.round(u.valToPos(x, 'x', true)) + 0.5
    ctx.strokeStyle = cssVar(TONE_VAR[markerTone(m)])
    ctx.globalAlpha = m.kind === 'input' || m.kind === 'foreground' ? 0.55 : 0.9
    ctx.beginPath()
    ctx.moveTo(px, top)
    ctx.lineTo(px, top + height)
    ctx.stroke()
  }
  ctx.restore()
}

/** 鼠标靠近某条标记竖线时，在竖线旁显示它的说明（同一处有多个时都列出来） */
function showMarkerTip(u: uPlot, markers: MetricsMarker[], tip: HTMLDivElement | null): void {
  if (!tip) return
  const left = u.cursor.left
  const near = left == null || left < 0 ? [] : markers.filter((m) => Math.abs(u.valToPos(m.t / 1000, 'x') - left) <= MARKER_HOVER_PX)
  if (!near.length) {
    tip.hidden = true
    return
  }
  tip.textContent = near.map((m) => `${new Date(m.t).toLocaleTimeString()}  ${markerText(m)}`).join('\n')
  tip.hidden = false
  const over = u.over.getBoundingClientRect()
  const host = tip.parentElement!.getBoundingClientRect()
  const x = over.left - host.left + left!
  // 靠右时放到竖线左边，避免超出卡片
  const flip = x > host.width * 0.6
  tip.style.left = flip ? '' : `${x + 8}px`
  tip.style.right = flip ? `${host.width - x + 8}px` : ''
  tip.style.top = `${over.top - host.top + 4}px`
}

/** 放大到指定范围；为空时恢复为全部数据 */
function applyZoom(plot: uPlot, zoom: [number, number] | null): void {
  const xs = plot.data[0]
  if (zoom) plot.setScale('x', { min: zoom[0], max: zoom[1] })
  else if (xs.length > 1) plot.setScale('x', { min: xs[0], max: xs[xs.length - 1] })
}

function showLatest(plot: uPlot): void {
  const last = plot.data[0].length - 1
  if (last >= 0) plot.setLegend({ idx: last })
}
