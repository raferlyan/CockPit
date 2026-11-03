import { useEffect, useMemo, useState } from 'react'
import type { LoadSample } from '@shared/metrics'
import type { Device } from '@shared/models'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ensureMetrics, useMetricsStore, type DeviceMetrics } from './metricsStore'
import { Chart, SERIES_COLORS } from './Chart'
import { alignSeries, BATTERY_STATUS_LABEL, formatKB, formatRate, memoryUsedPercent } from './format'

/** 曲线显示最近 5 分钟，与缓冲长度一致 */
const CHART_WINDOW_MS = 5 * 60_000

type CompareMetric = 'cpu' | 'memory' | 'cpuTemp'

const COMPARE_METRICS: Record<CompareMetric, { label: string; unit: string; range?: [number, number]; pick: (s: LoadSample) => number | undefined }> = {
  cpu: { label: 'CPU', unit: '%', range: [0, 100], pick: (s) => s.cpu?.total },
  memory: { label: '内存', unit: '%', range: [0, 100], pick: (s) => (s.memory ? memoryUsedPercent(s.memory) : undefined) },
  cpuTemp: { label: 'CPU 温度', unit: '°C', pick: (s) => s.thermal?.cpu }
}

/** wide：放在中间区域时用宽布局，图表与列表分两栏排开 */
export function StatusPanel({ wide = false }: { wide?: boolean }) {
  const devices = useAppStore((s) => s.devices)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const focused = devices.find((d) => d.serial === focusedSerial)
  const online = useMemo(() => devices.filter((d) => d.state === 'device'), [devices])
  const [compare, setCompare] = useState(false)

  useEffect(() => {
    for (const device of online) ensureMetrics(device.serial)
  }, [online])

  const showCompare = compare && online.length > 1

  return (
    <section className={`panel status-panel${wide ? ' wide' : ''}`}>
      <div className="panel-title-row">
        <h2 className="panel-title">设备状态</h2>
        {online.length > 1 && (
          <div className="segmented">
            <button className={showCompare ? '' : 'on'} onClick={() => setCompare(false)}>
              单台
            </button>
            <button className={showCompare ? 'on' : ''} onClick={() => setCompare(true)}>
              对比
            </button>
          </div>
        )}
      </div>
      {showCompare ? (
        <CompareView devices={online} />
      ) : focused?.state === 'device' ? (
        <DeviceStatus serial={focused.serial} />
      ) : (
        <p className="empty">选择一台在线设备查看负载</p>
      )}
    </section>
  )
}

function useRecent(metrics: DeviceMetrics | undefined): LoadSample[] {
  return useMemo(() => {
    const history = metrics?.history ?? []
    const since = (history.at(-1)?.t ?? 0) - CHART_WINDOW_MS
    return history.filter((s) => s.t >= since)
  }, [metrics?.history])
}

function DeviceStatus({ serial }: { serial: string }) {
  const metrics = useMetricsStore((s) => s.byDevice[serial])
  const wifiAdb = useAppStore((s) => s.devices.find((d) => d.serial === serial)?.connection === 'tcp')
  const recent = useRecent(metrics)
  const latest = metrics?.history.at(-1)

  const loadData = useMemo(
    () =>
      alignSeries([
        recent.map((s) => ({ t: s.t, v: s.cpu?.total })),
        recent.map((s) => ({ t: s.t, v: s.memory ? memoryUsedPercent(s.memory) : undefined }))
      ]),
    [recent]
  )
  const thermalKeys = (['cpu', 'battery', 'skin'] as const).filter((key) => latest?.thermal?.[key] !== undefined)
  const thermalData = useMemo(
    () => alignSeries(thermalKeys.map((key) => recent.map((s) => ({ t: s.t, v: s.thermal?.[key] })))),
    // thermalKeys 每次渲染都是新数组，用拼接后的字符串做依赖
    [recent, thermalKeys.join()]
  )

  if (!latest) {
    return <p className="empty">{metrics?.error ? <span className="error">采集失败：{metrics.error}</span> : '正在采集…'}</p>
  }

  const { cpu, memory, thermal, battery, net, loadavg } = latest
  return (
    <div className="status">
      {metrics?.error && <p className="error status-error">部分采集失败：{metrics.error}</p>}
      <div className="tiles">
        <Tile label="CPU" value={cpu ? `${cpu.total.toFixed(0)}%` : '—'} sub={loadavg ? `负载 ${loadavg.map((v) => v.toFixed(2)).join(' ')}` : undefined} />
        <Tile
          label="内存"
          value={memory ? `${memoryUsedPercent(memory).toFixed(0)}%` : '—'}
          sub={memory ? `${formatKB(memory.totalKB - memory.availableKB)} / ${formatKB(memory.totalKB)}` : undefined}
        />
        <Tile
          label="温度"
          value={thermal?.cpu !== undefined ? `${thermal.cpu.toFixed(1)}°C` : '—'}
          sub={[thermal?.gpu !== undefined && `GPU ${thermal.gpu.toFixed(1)}°`, thermal?.skin !== undefined && `机身 ${thermal.skin.toFixed(1)}°`].filter(Boolean).join(' · ') || undefined}
        />
        <Tile
          label="电池"
          value={battery ? `${battery.level}%` : '—'}
          sub={battery ? `${BATTERY_STATUS_LABEL[battery.status]} · ${battery.temperature.toFixed(1)}°C · ${(battery.voltage / 1000).toFixed(2)}V` : undefined}
        />
        {net && (
          <Tile
            label="网卡吞吐"
            value={`↓ ${formatRate(net.rxBps)}`}
            sub={`↑ ${formatRate(net.txBps)}${net.ifaces.length ? ` · ${net.ifaces.filter((i) => i.up).length} 块在线` : ''}`}
          />
        )}
        {memory && memory.swapTotalKB > 0 && (
          <Tile label="Swap / ZRAM" value={formatKB(memory.swapTotalKB - memory.swapFreeKB)} sub={`共 ${formatKB(memory.swapTotalKB)}`} />
        )}
      </div>

      <section className="status-section">
        <h3 className="status-heading">CPU 与内存占用</h3>
        <Chart
          series={[
            { label: 'CPU', color: SERIES_COLORS[0] },
            { label: '内存', color: SERIES_COLORS[1] }
          ]}
          data={loadData}
          range={[0, 100]}
          unit="%"
        />
      </section>

      {thermalKeys.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">温度</h3>
          <Chart
            series={thermalKeys.map((key, i) => ({ label: { cpu: 'CPU', battery: '电池', skin: '机身' }[key], color: SERIES_COLORS[i] }))}
            data={thermalData}
            unit="°C"
          />
        </section>
      )}

      {net && net.ifaces.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">网卡</h3>
          <table className="proc-table">
            <thead>
              <tr>
                <th>接口</th>
                <th className="num">接收</th>
                <th className="num">发送</th>
              </tr>
            </thead>
            <tbody>
              {net.ifaces.map((i) => (
                <tr key={i.name}>
                  <td className="proc-name mono">
                    <span className={`dot state-${i.up ? 'ok' : 'off'}`} title={i.up ? '已连接' : '未连接'} /> {i.name}
                  </td>
                  <td className="num mono">{formatRate(i.rxBps)}</td>
                  <td className="num mono">{formatRate(i.txBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {wifiAdb && <p className="muted net-note">当前经无线 adb 连接，投屏和终端的流量也会计入 wlan 网卡。</p>}
        </section>
      )}

      {cpu && (
        <section className="status-section">
          <h3 className="status-heading">各核心</h3>
          <div className="cores">
            {cpu.cores.map((usage, i) => (
              <div key={i} className="core" title={`cpu${i}`}>
                <span className="core-name">{i}</span>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${usage ?? 0}%` }} />
                </div>
                <span className="core-value mono">{usage === null ? '离线' : `${usage.toFixed(0)}%`}</span>
                <span className="core-freq mono muted">{cpu.freqMHz[i] ? `${cpu.freqMHz[i]} MHz` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {metrics?.processes && metrics.processes.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">进程 Top {metrics.processes.length}</h3>
          <table className="proc-table">
            <thead>
              <tr>
                <th>进程</th>
                <th className="num">CPU</th>
                <th className="num">内存</th>
              </tr>
            </thead>
            <tbody>
              {metrics.processes.map((p) => (
                <tr key={p.pid} title={`PID ${p.pid} · ${p.user}`}>
                  <td className="proc-name">{p.name}</td>
                  <td className="num mono">{p.cpu.toFixed(1)}%</td>
                  <td className="num mono">{p.resKB ? formatKB(p.resKB) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {metrics?.storage && metrics.storage.length > 0 && (
        <section className="status-section">
          <h3 className="status-heading">存储</h3>
          {metrics.storage.map((m) => {
            const percent = (m.usedKB / m.sizeKB) * 100
            return (
              <div key={m.mount} className="storage-row">
                <div className="storage-label">
                  <span className="mono">{m.mount}</span>
                  <span className="muted">
                    {formatKB(m.usedKB)} / {formatKB(m.sizeKB)}（剩余 {formatKB(m.availKB)}）
                  </span>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )
          })}
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

  const data = useMemo(() => {
    const now = Math.max(...shown.map((d) => byDevice[d.serial]?.history.at(-1)?.t ?? 0))
    return alignSeries(
      shown.map((d) => (byDevice[d.serial]?.history ?? []).filter((s) => s.t >= now - CHART_WINDOW_MS).map((s) => ({ t: s.t, v: config.pick(s) })))
    )
  }, [byDevice, shown, config])

  return (
    <div className="status">
      <div className="segmented compare-metrics">
        {(Object.keys(COMPARE_METRICS) as CompareMetric[]).map((key) => (
          <button key={key} className={key === metric ? 'on' : ''} onClick={() => setMetric(key)}>
            {COMPARE_METRICS[key].label}
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
            <th>设备</th>
            <th className="num">CPU</th>
            <th className="num">内存</th>
            <th className="num">温度</th>
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
                <td className="num mono">{latest?.memory ? `${memoryUsedPercent(latest.memory).toFixed(0)}%` : '—'}</td>
                <td className="num mono">{latest?.thermal?.cpu !== undefined ? `${latest.thermal.cpu.toFixed(1)}°` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {devices.length > shown.length && <p className="muted">最多同时对比 {SERIES_COLORS.length} 台设备</p>}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}
