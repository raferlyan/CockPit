import { useEffect, useMemo, useRef, useState } from 'react'
import { isThrottled, type AcceleratorLoad, type CpuCluster, type LoadSample } from '@shared/metrics'
import type { Device } from '@shared/models'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ensureMetrics, useMetricsStore } from './metricsStore'
import { Chart, SERIES_COLORS } from './Chart'
import { alignSeries, BATTERY_STATUS_LABEL, formatKB, formatRate, memoryUsedPercent } from './format'
import { StorageBrowser } from './StorageBrowser'
import { ProcessTable } from './ProcessTable'
import { AppSection, EventsSection } from './AppSection'
import { useFramesDemand } from './markers'
import { useTimelineStore, WINDOW_OPTIONS } from './timelineStore'
import { useReplayStore } from './replayStore'
import { RecordingsDialog } from './RecordingsDialog'
import { buildCsv, buildJson, exportFileName, sliceExport } from './exporting'
import type { DeviceMetrics } from './metricsStore'
import type { RecordedSession } from '@shared/metrics'
import { errorMessage, notify } from '../notify/notifyStore'
import { ActionButton } from '../notify/ActionButton'
import { clusterName, levelOf, thermalStatusLabel, thermalStatusLevel, THRESHOLDS, throttleSummary, type Level } from './thresholds'
import { api } from '../api'
import { t } from '../i18n'


type CompareMetric = 'cpu' | 'gpu' | 'memory' | 'cpuTemp'

/** 占用读不到时说明原因，频率和型号即使没有占用也照样显示 */
function acceleratorSub(load: AcceleratorLoad): string {
  const details = [load.freqMHz ? `${load.freqMHz} MHz` : '', load.model ?? ''].filter(Boolean).join(' · ')
  if (load.access === 'ok') return details
  const reason = load.access === 'needs-root' ? t('读取需要 root') : t('驱动未提供占用数据')
  return details ? `${reason} · ${details}` : reason
}

const COMPARE_METRICS: Record<CompareMetric, { label: () => string; unit: string; range?: [number, number]; pick: (s: LoadSample) => number | undefined }> = {
  cpu: { label: () => 'CPU', unit: '%', range: [0, 100], pick: (s) => s.cpu?.total },
  gpu: { label: () => 'GPU', unit: '%', range: [0, 100], pick: (s) => s.gpu?.busy },
  memory: { label: () => t('内存'), unit: '%', range: [0, 100], pick: (s) => (s.memory ? memoryUsedPercent(s.memory) : undefined) },
  cpuTemp: { label: () => t('CPU 温度'), unit: '°C', pick: (s) => s.thermal?.cpu }
}

/**
 * wide：放在中间区域时用宽布局，图表与列表分两栏排开。
 * standalone：在弹出的独立窗口里，不再显示“弹出”按钮。
 */
export function StatusPanel({ wide = false, standalone = false }: { wide?: boolean; standalone?: boolean }) {
  const devices = useAppStore((s) => s.devices)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const focused = devices.find((d) => d.serial === focusedSerial)
  const online = useMemo(() => devices.filter((d) => d.state === 'device'), [devices])
  const [compare, setCompare] = useState(false)
  const [recordingsOpen, setRecordingsOpen] = useState(false)
  const replay = useReplayStore((s) => s.session)

  useEffect(() => {
    for (const device of online) ensureMetrics(device.serial)
  }, [online])

  const showCompare = compare && online.length > 1 && !replay

  return (
    <section className={`panel status-panel${wide ? ' wide' : ''}`} data-tour="status">
      <div className="panel-title-row">
        <h2 className="panel-title">{t('设备状态')}</h2>
        <div className="status-actions">
          {online.length > 1 && !replay && (
            <div className="segmented">
              <button className={showCompare ? '' : 'on'} onClick={() => setCompare(false)}>
                {t('单台')}
              </button>
              <button className={showCompare ? 'on' : ''} onClick={() => setCompare(true)}>
                {t('对比')}
              </button>
            </div>
          )}
          {!replay && <PauseButton />}
          <button className="tool" title={t('录制的状态数据：回看、删除')} onClick={() => setRecordingsOpen(true)}>
            {t('历史')}
          </button>
          {!standalone && (
            <button className="tool" title={t('在独立窗口中打开设备状态，适合放到另一块屏幕上')} onClick={() => api.app.openStatusWindow()}>
              ⧉
            </button>
          )}
        </div>
      </div>
      {replay ? <ReplayBanner session={replay} /> : <PausedBanner />}
      {recordingsOpen && <RecordingsDialog onClose={() => setRecordingsOpen(false)} />}
      {replay ? (
        <DeviceStatus key={replay.name} serial={replay.serial} replay={replay} />
      ) : showCompare ? (
        <CompareView devices={online} />
      ) : focused?.state === 'device' ? (
        <DeviceStatus serial={focused.serial} />
      ) : (
        <p className="empty">{t('选择一台在线设备查看负载')}</p>
      )}
    </section>
  )
}

function PauseButton() {
  const paused = useTimelineStore((s) => s.pausedAt !== null)
  const { pause, resume } = useTimelineStore()
  return (
    <button className={`tool${paused ? ' on' : ''}`} title={paused ? t('恢复实时刷新') : t('暂停曲线（采集照常进行）')} onClick={paused ? resume : pause}>
      {paused ? '▶' : '❚❚'}
    </button>
  )
}

function ReplayBanner({ session }: { session: RecordedSession }) {
  const close = useReplayStore((s) => s.close)
  const zoomed = useTimelineStore((s) => s.zoom !== null)
  const resetZoom = useTimelineStore((s) => s.resetZoom)
  const first = session.history[0]?.t ?? session.startedAt
  const last = session.history.at(-1)?.t
  const minutes = first && last ? Math.max(1, Math.round((last - first) / 60_000)) : 0
  return (
    <div className="paused-banner replay-banner">
      <span title={session.name}>
        {t('正在回看 {device} · {time} · {m} 分钟', {
          device: session.device || session.serial,
          time: first ? new Date(first).toLocaleString() : '—',
          m: minutes
        })}
        {zoomed ? ` · ${t('已放大，双击曲线还原')}` : ''}
      </span>
      {zoomed && (
        <button className="link" onClick={resetZoom}>
          {t('还原')}
        </button>
      )}
      <button className="link" onClick={close}>
        {t('返回实时')}
      </button>
    </div>
  )
}

function PausedBanner() {
  const pausedAt = useTimelineStore((s) => s.pausedAt)
  const zoomed = useTimelineStore((s) => s.zoom !== null)
  const { resume, resetZoom } = useTimelineStore()
  if (pausedAt === null) return null
  return (
    <div className="paused-banner">
      <span>
        {t('已暂停于 {time}', { time: new Date(pausedAt).toLocaleTimeString() })}
        {' · '}
        {zoomed ? t('已放大，双击曲线还原') : t('在曲线上横向拖选可以放大')}
      </span>
      {zoomed && (
        <button className="link" onClick={resetZoom}>
          {t('还原')}
        </button>
      )}
      <button className="link" onClick={resume}>
        {t('恢复实时')}
      </button>
    </div>
  )
}

const EMPTY: never[] = []

/**
 * 曲线用的最近一段数据（时间窗可选 5 / 10 / 30 分钟，回看时是整个会话）。暂停时冻结在暂停那一刻的副本上：
 * 环形缓冲还在滚动，直接按时间过滤的话，暂停久了画面里的数据会被挤掉。
 */
function useRecent<T extends { t: number }>(source: T[] | undefined, windowMs: number): T[] {
  const paused = useTimelineStore((s) => s.pausedAt !== null)
  const frozen = useRef<T[] | null>(null)
  const live = source ?? (EMPTY as T[])
  if (!paused) frozen.current = null
  else frozen.current ??= live
  const history = frozen.current ?? live
  return useMemo(() => {
    if (!Number.isFinite(windowMs)) return history
    const since = (history.at(-1)?.t ?? 0) - windowMs
    return history.filter((s) => s.t >= since)
  }, [history, windowMs])
}

/** 回看时把录制会话当成一台设备的数据显示 */
function sessionMetrics(session: RecordedSession): DeviceMetrics {
  return {
    history: session.history,
    appHistory: session.appHistory,
    frameHistory: session.frameHistory,
    markers: session.markers,
    foreground: session.foreground,
    focus: session.focus
  }
}

function DeviceStatus({ serial, replay }: { serial: string; replay?: RecordedSession }) {
  const live = useMetricsStore((s) => s.byDevice[serial])
  const replayMetrics = useMemo(() => (replay ? sessionMetrics(replay) : undefined), [replay])
  const metrics = replayMetrics ?? live
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const wifiAdb = device?.connection === 'tcp'
  const windowMin = useTimelineStore((s) => s.windowMin)
  const windowMs = replay ? Infinity : windowMin * 60_000
  const recent = useRecent(metrics?.history, windowMs)
  const recentApp = useRecent(metrics?.appHistory, windowMs)
  const recentFrames = useRecent(metrics?.frameHistory, windowMs)
  const markers = metrics?.markers ?? EMPTY
  useFramesDemand(replay ? undefined : serial)
  const deviceName = replay ? replay.device || replay.serial : device ? deviceTitle(device) : serial
  // 暂停时卡片也停在暂停那一刻，和曲线对得上
  const latest = recent.at(-1)

  const showIowait = recent.some((s) => s.cpu?.iowait !== undefined)
  const loadData = useMemo(
    () =>
      alignSeries([
        recent.map((s) => ({ t: s.t, v: s.cpu?.total })),
        recent.map((s) => ({ t: s.t, v: s.memory ? memoryUsedPercent(s.memory) : undefined })),
        ...(showIowait ? [recent.map((s) => ({ t: s.t, v: s.cpu?.iowait }))] : [])
      ]),
    [recent, showIowait]
  )
  const psiKeys = (['cpu', 'memory', 'io'] as const).filter((key) => recent.some((s) => s.psi?.[key] !== undefined))
  const psiData = useMemo(() => alignSeries(psiKeys.map((key) => recent.map((s) => ({ t: s.t, v: s.psi?.[key] })))), [recent, psiKeys.join()])
  const showAccelChart = recent.some((s) => s.gpu?.busy !== undefined || s.npu?.busy !== undefined)
  const accelSeries = (['gpu', 'npu'] as const).filter((key) => recent.some((s) => s[key]?.busy !== undefined))
  const accelData = useMemo(() => alignSeries(accelSeries.map((key) => recent.map((s) => ({ t: s.t, v: s[key]?.busy })))), [recent, accelSeries.join()])
  const thermalKeys = (['cpu', 'battery', 'skin'] as const).filter((key) => latest?.thermal?.[key] !== undefined)
  const thermalData = useMemo(
    () => alignSeries(thermalKeys.map((key) => recent.map((s) => ({ t: s.t, v: s.thermal?.[key] })))),
    // thermalKeys 每次渲染都是新数组，用拼接后的字符串做依赖
    [recent, thermalKeys.join()]
  )

  if (!latest) {
    return (
      <p className="empty">
        {metrics?.error ? (
          <span className="error">
            {t('采集失败：')}
            {metrics.error}
          </span>
        ) : (
          t('正在采集…')
        )}
      </p>
    )
  }

  const { cpu, gpu, npu, memory, thermal, battery, net, loadavg, thermalStatus } = latest
  const toolbar = <StatusToolbar serial={serial} deviceName={deviceName} metrics={metrics!} recent={recent} replay={!!replay} />
  const throttle = throttleSummary(cpu?.clusters)
  const memoryPercent = memory ? memoryUsedPercent(memory) : undefined
  const cpuSub = [
    cpu?.iowait !== undefined && cpu.iowait >= 1 ? t('IO 等待 {v}%', { v: cpu.iowait.toFixed(0) }) : '',
    loadavg ? t('负载 {v}', { v: loadavg.map((v) => v.toFixed(2)).join(' ') }) : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="status">
      {toolbar}
      {metrics?.error && (
        <p className="error status-error">
          {t('部分采集失败：')}
          {metrics.error}
        </p>
      )}
      <div className="tiles">
        <Tile
          label="CPU"
          value={cpu ? `${cpu.total.toFixed(0)}%` : '—'}
          sub={cpuSub || undefined}
          level={worst(levelOf(cpu?.total, THRESHOLDS.cpu), levelOf(cpu?.iowait, THRESHOLDS.iowait))}
        />
        {gpu && <Tile label="GPU" value={gpu.busy !== undefined ? `${gpu.busy.toFixed(0)}%` : '—'} sub={acceleratorSub(gpu)} />}
        {npu && <Tile label="NPU" value={npu.busy !== undefined ? `${npu.busy.toFixed(0)}%` : '—'} sub={acceleratorSub(npu)} />}
        <Tile
          label={t('内存')}
          value={memoryPercent !== undefined ? `${memoryPercent.toFixed(0)}%` : '—'}
          sub={memory ? `${formatKB(memory.totalKB - memory.availableKB)} / ${formatKB(memory.totalKB)}` : undefined}
          level={levelOf(memoryPercent, THRESHOLDS.memory)}
        />
        <Tile
          label={t('温度')}
          value={thermal?.cpu !== undefined ? `${thermal.cpu.toFixed(1)}°C` : '—'}
          sub={
            [thermal?.gpu !== undefined && `GPU ${thermal.gpu.toFixed(1)}°`, thermal?.skin !== undefined && t('机身 {v}°', { v: thermal.skin.toFixed(1) })]
              .filter(Boolean)
              .join(' · ') || undefined
          }
          level={levelOf(thermal?.cpu, THRESHOLDS.cpuTemp)}
        />
        {(thermalStatus !== undefined || cpu?.clusters) && (
          <Tile
            label={t('温控')}
            value={thermalStatus !== undefined ? thermalStatusLabel(thermalStatus) : '—'}
            // 读不到频率上限时不下“未限频”的结论
            sub={throttle ? t('限频：{v}', { v: throttle }) : cpu?.clusters ? t('未限频') : undefined}
            level={worst(thermalStatusLevel(thermalStatus), throttle ? 'warn' : 'ok')}
          />
        )}
        <Tile
          label={t('电池')}
          value={battery ? `${battery.level}%` : '—'}
          sub={battery ? `${BATTERY_STATUS_LABEL()[battery.status]} · ${battery.temperature.toFixed(1)}°C · ${(battery.voltage / 1000).toFixed(2)}V` : undefined}
        />
        {net && (
          <Tile
            label={t('网卡吞吐')}
            value={`↓ ${formatRate(net.rxBps)}`}
            sub={`↑ ${formatRate(net.txBps)}${net.ifaces.length ? ` · ${t('{n} 块在线', { n: net.ifaces.filter((i) => i.up).length })}` : ''}`}
          />
        )}
        {memory && memory.swapTotalKB > 0 && (
          <Tile label="Swap / ZRAM" value={formatKB(memory.swapTotalKB - memory.swapFreeKB)} sub={t('共 {v}', { v: formatKB(memory.swapTotalKB) })} />
        )}
      </div>

      {metrics && (
        <AppSection
          serial={serial}
          metrics={metrics}
          recentLoad={recent}
          recentApp={recentApp}
          recentFrames={recentFrames}
          markers={markers}
          tile={Tile}
          readOnly={!!replay}
        />
      )}

      <section className="status-section">
        <h3 className="status-heading">{t('CPU 与内存占用')}</h3>
        <Chart
          series={[
            { label: 'CPU', color: SERIES_COLORS[0] },
            { label: t('内存'), color: SERIES_COLORS[1] },
            ...(showIowait ? [{ label: t('IO 等待'), color: SERIES_COLORS[2] }] : [])
          ]}
          data={loadData}
          range={[0, 100]}
          unit="%"
          markers={markers}
        />
      </section>

      {psiKeys.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading" title={t('最近 10 秒里至少有一个任务在等这项资源的时间占比（PSI）。占用率高不一定卡，压力高说明有任务在排队。')}>
            {t('资源压力')}
          </h3>
          <Chart
            series={psiKeys.map((key, i) => ({ label: { cpu: 'CPU', memory: t('内存'), io: 'IO' }[key], color: SERIES_COLORS[i] }))}
            data={psiData}
            range={[0, 100]}
            unit="%"
            markers={markers}
          />
        </section>
      )}

      {showAccelChart && (
        <section className="status-section">
          <h3 className="status-heading">{t('GPU 与 NPU 占用')}</h3>
          <Chart
            series={accelSeries.map((key, i) => ({ label: key.toUpperCase(), color: SERIES_COLORS[i] }))}
            data={accelData}
            range={[0, 100]}
            unit="%"
            markers={markers}
          />
        </section>
      )}

      {thermalKeys.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">{t('温度')}</h3>
          <Chart
            series={thermalKeys.map((key, i) => ({ label: { cpu: 'CPU', battery: t('电池'), skin: t('机身') }[key], color: SERIES_COLORS[i] }))}
            data={thermalData}
            unit="°C"
            markers={markers}
          />
        </section>
      )}

      {net && net.ifaces.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">{t('网卡')}</h3>
          <table className="proc-table">
            <thead>
              <tr>
                <th>{t('接口')}</th>
                <th className="num">{t('接收')}</th>
                <th className="num">{t('发送')}</th>
              </tr>
            </thead>
            <tbody>
              {net.ifaces.map((i) => (
                <tr key={i.name}>
                  <td className="proc-name mono">
                    <span className={`dot state-${i.up ? 'ok' : 'off'}`} title={i.up ? t('已连接') : t('未连接')} /> {i.name}
                  </td>
                  <td className="num mono">{formatRate(i.rxBps)}</td>
                  <td className="num mono">{formatRate(i.txBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {wifiAdb && <p className="muted net-note">{t('当前经无线 adb 连接，投屏和终端的流量也会计入 wlan 网卡。')}</p>}
        </section>
      )}

      {cpu && (
        <section className="status-section">
          <h3 className="status-heading">{t('各核心')}</h3>
          <CoreList cpu={cpu} />
        </section>
      )}

      <EventsSection markers={markers} />

      {metrics?.processes && metrics.processes.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">{t('进程')}</h3>
          <ProcessTable serial={serial} processes={metrics.processes} focusPkg={metrics.focus?.pkg} foregroundPkg={metrics.foreground?.pkg} />
        </section>
      )}

      {metrics?.storage && metrics.storage.length > 0 && (
        <section className="status-section span-all">
          <h3 className="status-heading">{t('存储')}</h3>
          <StorageBrowser serial={serial} mounts={metrics.storage} />
        </section>
      )}
    </div>
  )
}

function CompareView({ devices }: { devices: Device[] }) {
  const [metric, setMetric] = useState<CompareMetric>('cpu')
  const byDevice = useMetricsStore((s) => s.byDevice)
  // 分类色只有 3 个，按设计最多同时对比 3 台
  const shown = useMemo(() => devices.slice(0, SERIES_COLORS.length), [devices])
  const config = COMPARE_METRICS[metric]
  const windowMs = useTimelineStore((s) => s.windowMin) * 60_000

  const data = useMemo(() => {
    const now = Math.max(...shown.map((d) => byDevice[d.serial]?.history.at(-1)?.t ?? 0))
    return alignSeries(
      shown.map((d) => (byDevice[d.serial]?.history ?? []).filter((s) => s.t >= now - windowMs).map((s) => ({ t: s.t, v: config.pick(s) })))
    )
  }, [byDevice, shown, config, windowMs])

  return (
    <div className="status">
      <div className="segmented compare-metrics">
        {(Object.keys(COMPARE_METRICS) as CompareMetric[]).map((key) => (
          <button key={key} className={key === metric ? 'on' : ''} onClick={() => setMetric(key)}>
            {COMPARE_METRICS[key].label()}
          </button>
        ))}
      </div>
      <Chart
        series={shown.map((d, i) => ({ label: deviceTitle(d), color: SERIES_COLORS[i] }))}
        data={data}
        range={config.range}
        unit={config.unit}
        height={200}
      />
      <table className="proc-table compare-table">
        <thead>
          <tr>
            <th>{t('设备')}</th>
            <th className="num">CPU</th>
            <th className="num">GPU</th>
            <th className="num">{t('内存')}</th>
            <th className="num">{t('温度')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d, i) => {
            const latest = byDevice[d.serial]?.history.at(-1)
            return (
              <tr key={d.serial}>
                <td className="proc-name">
                  <span className="swatch" style={{ background: SERIES_COLORS[i] }} />
                  {deviceTitle(d)}
                </td>
                <td className="num mono">{latest?.cpu ? `${latest.cpu.total.toFixed(0)}%` : '—'}</td>
                <td className="num mono">{latest?.gpu?.busy !== undefined ? `${latest.gpu.busy.toFixed(0)}%` : '—'}</td>
                <td className="num mono">{latest?.memory ? `${memoryUsedPercent(latest.memory).toFixed(0)}%` : '—'}</td>
                <td className="num mono">{latest?.thermal?.cpu !== undefined ? `${latest.thermal.cpu.toFixed(1)}°` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {devices.length > shown.length && <p className="muted">{t('最多同时对比 {n} 台设备', { n: SERIES_COLORS.length })}</p>}
    </div>
  )
}

interface StatusToolbarProps {
  serial: string
  deviceName: string
  metrics: DeviceMetrics
  /** 当前显示的数据（已按时间窗截取），没有放大时按它的范围导出 */
  recent: LoadSample[]
  replay: boolean
}

/** 时间窗、录制、导出 */
function StatusToolbar({ serial, deviceName, metrics, recent, replay }: StatusToolbarProps) {
  const windowMin = useTimelineStore((s) => s.windowMin)
  const setWindow = useTimelineStore((s) => s.setWindow)
  const zoom = useTimelineStore((s) => s.zoom)
  const recording = metrics.recording
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [recording])

  const toggleRecording = async () => {
    try {
      if (!recording) await api.metrics.startRecording(serial)
      else {
        const file = await api.metrics.stopRecording(serial)
        if (file) notify('success', t('状态数据已保存'), file.name)
      }
    } catch (error) {
      notify('error', recording ? t('停止录制失败') : t('开始录制失败'), errorMessage(error))
    }
  }

  const exportAs = async (ext: 'csv' | 'json') => {
    // 放大了就导出放大的区间，否则导出当前时间窗
    const from = zoom ? zoom[0] * 1000 : (recent[0]?.t ?? 0)
    const to = zoom ? zoom[1] * 1000 : (recent.at(-1)?.t ?? Date.now())
    const data = sliceExport(
      { device: deviceName, serial, history: metrics.history, appHistory: metrics.appHistory ?? [], frameHistory: metrics.frameHistory ?? [], markers: metrics.markers ?? [] },
      from,
      to
    )
    if (!data.history.length) {
      notify('info', t('这段时间没有数据可导出'))
      return
    }
    try {
      const path = await api.metrics.saveExport(exportFileName(data, ext), ext === 'csv' ? buildCsv(data) : buildJson(data))
      if (path) notify('success', t('已导出'), path)
    } catch (error) {
      notify('error', t('导出失败'), errorMessage(error))
    }
  }

  return (
    <div className="status-toolbar">
      {!replay && (
        <div className="segmented" title={t('曲线显示的时间范围')}>
          {WINDOW_OPTIONS.map((m) => (
            <button key={m} className={windowMin === m ? 'on' : ''} onClick={() => setWindow(m)}>
              {t('{m} 分钟', { m })}
            </button>
          ))}
        </div>
      )}
      <span className="spacer" />
      {!replay && (
        <ActionButton
          className={`tool record-toggle${recording ? ' on' : ''}`}
          onClick={toggleRecording}
          title={recording ? recording.path : t('把这台设备的状态数据持续写到文件，不限时长，之后可以在「历史」里回看')}
        >
          {recording ? t('■ 停止录制 {time}', { time: duration(now - recording.startedAt) }) : t('● 录制')}
        </ActionButton>
      )}
      <span className="muted toolbar-label">{zoom ? t('导出放大区间') : t('导出')}</span>
      <button className="tool" onClick={() => void exportAs('csv')} title={t('每秒一行，可以用表格软件打开')}>
        CSV
      </button>
      <button className="tool" onClick={() => void exportAs('json')} title={t('完整的原始数据，适合用脚本分析')}>
        JSON
      </button>
    </div>
  )
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

type Cpu = NonNullable<LoadSample['cpu']>

/** 每核占用与频率；读到簇信息时按小 / 中 / 大核分组，并标出被限频的簇 */
function CoreList({ cpu }: { cpu: Cpu }) {
  const groups: { cluster?: CpuCluster; cores: number[] }[] = cpu.clusters?.length
    ? cpu.clusters.map((cluster) => ({ cluster, cores: cluster.cores.filter((i) => i < cpu.cores.length) }))
    : [{ cores: cpu.cores.map((_, i) => i) }]
  // 不在任何簇里的核（离线时读不到 cpufreq 节点）放到最后
  const grouped = new Set(groups.flatMap((g) => g.cores))
  const rest = cpu.cores.map((_, i) => i).filter((i) => !grouped.has(i))
  if (rest.length) groups.push({ cores: rest })

  return (
    <div className="cores">
      {groups.map((group, gi) => (
        <div key={gi} className="core-group">
          {group.cluster && cpu.clusters && (
            <div className={`core-group-title${isThrottled(group.cluster) ? ' throttled' : ''}`}>
              <span>{clusterName(gi, cpu.clusters.length)}</span>
              <span className="mono muted">
                {isThrottled(group.cluster)
                  ? t('限频 {limit} / {max} MHz', { limit: group.cluster.limitMHz, max: group.cluster.maxMHz })
                  : t('最高 {max} MHz', { max: group.cluster.maxMHz })}
              </span>
            </div>
          )}
          {group.cores.map((i) => {
            const usage = cpu.cores[i]
            return (
              <div key={i} className="core" title={`cpu${i}`}>
                <span className="core-name">{i}</span>
                <div className="bar">
                  <div className={`bar-fill level-${levelOf(usage ?? undefined, THRESHOLDS.cpu)}`} style={{ width: `${usage ?? 0}%` }} />
                </div>
                <span className="core-value mono">{usage === null ? t('离线') : `${usage.toFixed(0)}%`}</span>
                <span className="core-freq mono muted">{cpu.freqMHz[i] ? `${cpu.freqMHz[i]} MHz` : ''}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const LEVEL_ORDER: Level[] = ['ok', 'warn', 'danger']

function worst(...levels: Level[]): Level {
  return levels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a), 'ok')
}

function Tile({ label, value, sub, level = 'ok' }: { label: string; value: string; sub?: string; level?: Level }) {
  return (
    <div className={`tile level-${level}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub" title={sub}>
        {sub}
      </div>
    </div>
  )
}
