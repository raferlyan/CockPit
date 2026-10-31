import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

/** 分类色：深色面板上验证过色觉障碍区分度与对比度，按固定顺序分配，不循环 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70']

const AXIS = { stroke: '#8b929e', grid: { stroke: '#2c313a', width: 1 }, ticks: { show: false }, font: '10px -apple-system, sans-serif' }

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
}

/**
 * uPlot 折线图。系列配置变化时重建实例，数据变化时只 setData。
 * 图例显示悬停处的数值，兼作 tooltip。
 */
export function Chart({ series, data, range, unit, height = 150 }: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const seriesKey = series.map((s) => `${s.label}:${s.color}`).join('|') + (range?.join(',') ?? '')

  useEffect(() => {
    const host = hostRef.current!
    const format = (v: number | null) => (v == null ? '—' : `${v.toFixed(unit === '%' ? 0 : 1)}${unit}`)
    const plot = new uPlot(
      {
        width: host.clientWidth || 280,
        height,
        cursor: { y: false, points: { size: 8 } },
        legend: { live: true },
        // 不悬停时图例显示最新值
        hooks: { setCursor: [(u) => u.cursor.idx == null && showLatest(u)] },
        scales: { x: { time: true }, y: range ? { range: () => range } : { auto: true } },
        axes: [
          { ...AXIS, size: 24, space: 60, values: (_u, ticks) => ticks.map((t) => new Date(t * 1000).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })) },
          { ...AXIS, size: 36, values: (_u, ticks) => ticks.map((t) => `${t}${unit}`) }
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

    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0) plot.setSize({ width: host.clientWidth, height })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // data 走下面的 setData，不触发重建
  }, [seriesKey, unit, height])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    plot.setData(data)
    if (plot.cursor.idx == null) showLatest(plot)
  }, [data])

  return <div ref={hostRef} className="chart" />
}

function showLatest(plot: uPlot): void {
  const last = plot.data[0].length - 1
  if (last >= 0) plot.setLegend({ idx: last })
}
