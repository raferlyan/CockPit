import { useMemo, useState, type ReactNode } from 'react'
import type { AppSample, FrameStats, LoadSample, MetricsMarker } from '@shared/metrics'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'
import { Chart, SERIES_COLORS } from './Chart'
import { alignSeries, formatKB } from './format'
import type { DeviceMetrics } from './metricsStore'
import { MARKER_SHORTCUT, markerText, markerTone } from './markers'
import { levelOf, THRESHOLDS, type Level } from './thresholds'
import { useTimelineStore } from './timelineStore'

/** 卡顿帧占比的提醒 / 严重阈值 */
const JANK_THRESHOLD: [number, number] = [10, 25]
const EVENT_LIST_LIMIT = 50
/** 点击事件时放大到它前后这么多秒 */
const EVENT_ZOOM_SECONDS = 15

interface AppSectionProps {
  serial: string
  metrics: DeviceMetrics
  /** 与系统曲线同一时间窗（暂停时已冻结） */
  recentLoad: LoadSample[]
  recentApp: AppSample[]
  recentFrames: FrameStats[]
  markers: MetricsMarker[]
  tile: (props: { label: string; value: string; sub?: string; level?: Level }) => ReactNode
  /** 回看录制数据：不显示固定 / 跟随的操作 */
  readOnly?: boolean
}

/**
 * 应用视角：前台帧率与卡顿、关注应用的 CPU / 内存 / 线程。
 * 关注应用默认跟随前台；固定后切走也继续采这个应用（帧率始终是前台应用的）。
 */
export function AppSection({ serial, metrics, recentLoad, recentApp, recentFrames, markers, tile: Tile, readOnly = false }: AppSectionProps) {
  const focus = metrics.focus
  const foreground = metrics.foreground
  const frames = recentFrames.at(-1)
  const app = recentApp.at(-1)

  const fpsData = useMemo(() => alignSeries([recentFrames.map((f) => ({ t: f.t, v: f.fps }))]), [recentFrames])
  const cpuData = useMemo(
    () => alignSeries([recentApp.map((s) => ({ t: s.t, v: s.cpu })), recentLoad.map((s) => ({ t: s.t, v: s.cpu?.total }))]),
    [recentApp, recentLoad]
  )
  const memData = useMemo(
    () =>
      alignSeries([
        recentApp.map((s) => ({ t: s.t, v: s.rssKB !== undefined ? s.rssKB / 1024 : undefined })),
        recentApp.map((s) => ({ t: s.t, v: s.pssKB !== undefined ? s.pssKB / 1024 : undefined }))
      ]),
    [recentApp]
  )
  const hasPss = recentApp.some((s) => s.pssKB !== undefined)
  const refresh = frames?.refreshHz ?? recentFrames.findLast((f) => f.refreshHz)?.refreshHz

  const setPinned = (pkg: string | null) => void api.metrics.setFocusApp(serial, pkg).catch((error) => notify('error', t('设置关注应用失败'), errorMessage(error)))

  if (!focus?.pkg && !foreground && !app && !frames) {
    return (
      <section className="status-section span-all app-section">
        <h3 className="status-heading">{t('应用')}</h3>
        <p className="muted">{readOnly ? t('录制里没有应用数据') : t('正在识别前台应用…')}</p>
      </section>
    )
  }

  const framesOfOther = frames && focus?.pkg && frames.pkg !== focus.pkg
  return (
    <section className="status-section span-all app-section">
      <h3 className="status-heading app-heading">
        <span>{t('应用')}</span>
        <span className="mono app-pkg" title={foreground?.activity}>
          {focus?.pkg ?? foreground?.pkg ?? app?.pkg ?? frames?.pkg}
        </span>
        <span className="spacer" />
        {readOnly ? null : focus?.pinned ? (
          <>
            <span className="badge">{t('已固定')}</span>
            <button className="link" onClick={() => setPinned(null)} title={t('恢复为跟随前台应用')}>
              {t('跟随前台')}
            </button>
          </>
        ) : (
          <>
            <span className="muted">{t('跟随前台')}</span>
            {focus?.pkg && (
              <button className="link" onClick={() => setPinned(focus.pkg!)} title={t('切到其他应用后也继续采集这个应用')}>
                {t('固定')}
              </button>
            )}
          </>
        )}
      </h3>

      <div className="tiles app-tiles">
        <Tile
          label={framesOfOther ? t('前台帧率（{pkg}）', { pkg: frames.pkg }) : t('帧率')}
          value={!frames ? '—' : frames.idle ? t('静止') : `${frames.fps.toFixed(0)} fps`}
          sub={frames ? [refresh && `${refresh} Hz`, frames.source === 'sf' ? 'SurfaceFlinger' : 'HWUI'].filter(Boolean).join(' · ') : t('读取帧数据…')}
        />
        <Tile
          label={t('卡顿帧')}
          value={frames?.jankRatio !== undefined ? `${frames.jankRatio.toFixed(0)}%` : '—'}
          sub={frames?.p90 !== undefined ? t('帧耗时 P50 {p50} · P90 {p90} · P99 {p99} ms', { p50: frames.p50, p90: frames.p90, p99: frames.p99 }) : undefined}
          level={levelOf(frames?.jankRatio, JANK_THRESHOLD)}
        />
        <Tile
          label={t('应用 CPU')}
          value={app?.cpu !== undefined ? `${app.cpu.toFixed(1)}%` : '—'}
          sub={app ? t('{n} 个进程 · {t} 个线程', { n: app.pids.length, t: app.threads ?? '—' }) : t('应用未运行')}
          level={levelOf(app?.cpu, THRESHOLDS.cpu)}
        />
        <Tile
          label={t('应用内存')}
          value={app?.pssKB !== undefined ? formatKB(app.pssKB) : app?.rssKB !== undefined ? formatKB(app.rssKB) : '—'}
          sub={app?.pssKB !== undefined ? `PSS · RSS ${app.rssKB !== undefined ? formatKB(app.rssKB) : '—'}` : app?.rssKB !== undefined ? 'RSS' : undefined}
        />
      </div>

      <div className="app-charts">
        <div>
          <h4 className="status-subheading">{t('帧率')}</h4>
          <Chart series={[{ label: 'FPS', color: SERIES_COLORS[0] }]} data={fpsData} range={[0, Math.max(60, refresh ?? 60)]} unit=" fps" markers={markers} />
        </div>
        <div>
          <h4 className="status-subheading" title={t('超过刷新周期（或系统给出的截止时间）才画完的帧标红')}>
            {t('最近 {n} 帧耗时', { n: frames?.recent?.length ?? 0 })}
          </h4>
          <FrameBars frames={frames?.recent ?? []} refreshHz={refresh} />
        </div>
        <div>
          <h4 className="status-subheading">{t('CPU：应用 / 整机')}</h4>
          <Chart
            series={[
              { label: t('应用'), color: SERIES_COLORS[0] },
              { label: t('整机'), color: SERIES_COLORS[1] }
            ]}
            data={cpuData}
            range={[0, 100]}
            unit="%"
            markers={markers}
          />
        </div>
        <div>
          <h4 className="status-subheading">{t('应用内存')}</h4>
          <Chart
            series={[{ label: 'RSS', color: SERIES_COLORS[0] }, ...(hasPss ? [{ label: 'PSS', color: SERIES_COLORS[1] }] : [])]}
            data={hasPss ? memData : [memData[0], memData[1]]}
            unit=" MB"
            markers={markers}
          />
        </div>
      </div>

      {metrics.threads && metrics.threads.length > 0 && (
        <>
          <h4 className="status-subheading">{t('线程 Top {n}', { n: metrics.threads.length })}</h4>
          <table className="proc-table">
            <thead>
              <tr>
                <th>{t('线程')}</th>
                <th className="num">TID</th>
                <th className="num" title={t('单核口径：占满一个核为 100%')}>
                  CPU
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.threads.map((th) => (
                <tr key={th.tid}>
                  <td className="proc-name mono">{th.name}</td>
                  <td className="num mono muted">{th.tid}</td>
                  <td className="num mono">{th.cpu.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

/** 最近 120 帧的耗时柱状图，虚线是一个刷新周期 */
function FrameBars({ frames, refreshHz }: { frames: number[]; refreshHz?: number }) {
  const budget = refreshHz ? 1000 / refreshHz : 16.7
  // 纵轴上限至少是 3 个刷新周期，偶发的长帧截断在顶部，避免把其余柱子压扁
  const top = Math.max(budget * 3, Math.min(Math.max(...frames, 0), budget * 6))
  if (!frames.length) return <p className="muted frame-bars-empty">{t('滑动或操作应用后这里显示每一帧的耗时')}</p>
  const width = 100 / Math.max(frames.length, 60)
  return (
    <div className="frame-bars" title={t('虚线：一个刷新周期 {ms} ms', { ms: budget.toFixed(1) })}>
      <div className="frame-budget" style={{ bottom: `${(budget / top) * 100}%` }} />
      {frames.map((ms, i) => (
        <div
          key={i}
          className={`frame-bar${ms > budget ? ' slow' : ''}`}
          style={{ left: `${i * width}%`, width: `${width}%`, height: `${Math.min(100, (ms / top) * 100)}%` }}
          title={`${ms} ms`}
        />
      ))}
    </div>
  )
}

/** 时间轴事件列表，新的在上；点一条放大到它前后 15 秒 */
export function EventsSection({ markers }: { markers: MetricsMarker[] }) {
  const [showInputs, setShowInputs] = useState(false)
  const setZoom = useTimelineStore((s) => s.setZoom)
  const list = useMemo(
    () => markers.filter((m) => showInputs || m.kind !== 'input').slice(-EVENT_LIST_LIMIT).reverse(),
    [markers, showInputs]
  )
  return (
    <section className="status-section events-section">
      <h3 className="status-heading app-heading">
        <span>{t('事件')}</span>
        <span className="spacer" />
        <label className="muted events-toggle">
          <input type="checkbox" checked={showInputs} onChange={(e) => setShowInputs(e.target.checked)} />
          {t('显示输入')}
        </label>
      </h3>
      {list.length ? (
        <ul className="event-list">
          {list.map((m) => (
            <li key={m.id}>
              <button
                className={`event-item tone-${markerTone(m)}`}
                onClick={() => setZoom([m.t / 1000 - EVENT_ZOOM_SECONDS, m.t / 1000 + EVENT_ZOOM_SECONDS])}
                title={[markerText(m), m.detail].filter(Boolean).join('\n')}
              >
                <span className="mono muted">{new Date(m.t).toLocaleTimeString()}</span>
                <span className="event-text">{markerText(m)}</span>
                {/* 告警的读数已经在文字里了 */}
                {m.detail && m.kind !== 'alert' && <span className="event-detail muted">{m.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('应用切换、崩溃、ANR、卡顿和设备操作会出现在这里；按 {key} 可以手动打一个标记', { key: MARKER_SHORTCUT })}</p>
      )}
    </section>
  )
}
