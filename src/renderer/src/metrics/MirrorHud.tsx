import { useEffect, useMemo, type ReactNode } from 'react'
import type { LoadSample } from '@shared/metrics'
import { ensureMetrics, useMetricsStore } from './metricsStore'
import { memoryUsedPercent } from './format'
import { levelOf, thermalStatusLabel, thermalStatusLevel, THRESHOLDS, throttleSummary, type Level } from './thresholds'
import { useSettingsStore } from '../settings/settingsStore'
import { useFramesDemand } from './markers'
import { t } from '../i18n'

/** 迷你曲线显示最近这么多秒 */
const SPARK_SECONDS = 60
const SPARK_W = 48
const SPARK_H = 14

/**
 * 投屏画面上方的负载条：一边操作一边看负载，不用把视线移到侧栏。
 * 只读 metricsStore，不新增采集；正常的项保持安静，超过阈值才变色，
 * IO 等待、资源压力这类平时为零的项只在偏高时出现。点一下展开右侧的完整状态面板。
 */
export function MirrorHud({ serial }: { serial: string }) {
  const history = useMetricsStore((s) => s.byDevice[serial]?.history)
  const foreground = useMetricsStore((s) => s.byDevice[serial]?.foreground)
  const frames = useMetricsStore((s) => s.byDevice[serial]?.frameHistory?.at(-1))
  useEffect(() => ensureMetrics(serial), [serial])
  useFramesDemand(serial)
  const latest = history?.at(-1)
  const spark = useMemo(() => sparkPath(history ?? []), [history])
  const openSide = () => useSettingsStore.getState().toggleCollapsed('side', false)

  if (!latest) {
    return (
      <div className="mirror-hud" onClick={openSide}>
        <span className="muted">{t('正在采集负载…')}</span>
      </div>
    )
  }

  const { cpu, memory, thermal, thermalStatus, psi } = latest
  const memoryPercent = memory ? memoryUsedPercent(memory) : undefined
  const throttle = throttleSummary(cpu?.clusters)
  const iowaitLevel = levelOf(cpu?.iowait, THRESHOLDS.iowait)
  const psiCpuLevel = levelOf(psi?.cpu, THRESHOLDS.psi)
  const psiMemLevel = levelOf(psi?.memory, THRESHOLDS.psi)

  return (
    <div className="mirror-hud" onClick={openSide} title={t('点击查看完整设备状态')}>
      <Item label="CPU" value={cpu ? `${cpu.total.toFixed(0)}%` : '—'} level={levelOf(cpu?.total, THRESHOLDS.cpu)}>
        {spark && (
          <svg className="hud-spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden>
            <path d={spark} />
          </svg>
        )}
      </Item>
      <Item label={t('内存')} value={memoryPercent !== undefined ? `${memoryPercent.toFixed(0)}%` : '—'} level={levelOf(memoryPercent, THRESHOLDS.memory)} />
      {thermal?.cpu !== undefined && <Item label={t('CPU 温度')} value={`${thermal.cpu.toFixed(1)}°C`} level={levelOf(thermal.cpu, THRESHOLDS.cpuTemp)} />}
      {thermalStatus !== undefined && thermalStatus >= 1 && (
        <Item label={t('温控')} value={thermalStatusLabel(thermalStatus)} level={thermalStatusLevel(thermalStatus)} />
      )}
      {throttle && <Item label={t('限频')} value={throttle} level="warn" />}
      {iowaitLevel !== 'ok' && <Item label={t('IO 等待')} value={`${cpu!.iowait!.toFixed(0)}%`} level={iowaitLevel} />}
      {psiCpuLevel !== 'ok' && <Item label={t('CPU 压力')} value={`${psi!.cpu!.toFixed(0)}%`} level={psiCpuLevel} />}
      {psiMemLevel !== 'ok' && <Item label={t('内存压力')} value={`${psi!.memory!.toFixed(0)}%`} level={psiMemLevel} />}
      {foreground && (
        <span className="hud-app">
          <span className="hud-pkg mono" title={foreground.activity}>
            {foreground.pkg}
          </span>
          {frames && frames.pkg === foreground.pkg && (
            <>
              <Item label="" value={frames.idle ? t('静止') : `${frames.fps.toFixed(0)} fps`} level="ok" />
              {!frames.idle && frames.jankRatio !== undefined && (
                <Item label={t('卡顿')} value={`${frames.jankRatio.toFixed(0)}%`} level={levelOf(frames.jankRatio, [10, 25])} />
              )}
            </>
          )}
        </span>
      )}
    </div>
  )
}

function Item({ label, value, level, children }: { label: string; value: string; level: Level; children?: ReactNode }) {
  return (
    <span className={`hud-item level-${level}`}>
      <span className="hud-label">{label}</span>
      <span className="hud-value mono">{value}</span>
      {children}
    </span>
  )
}

/** 最近 60 秒 CPU 总占用的折线路径（0–100 映射到高度）；不足两个点时不画 */
function sparkPath(history: LoadSample[]): string | null {
  const last = history.at(-1)?.t
  if (last === undefined) return null
  const points = history.filter((s) => s.cpu && s.t >= last - SPARK_SECONDS * 1000)
  if (points.length < 2) return null
  const x = (tMs: number) => SPARK_W - ((last - tMs) / (SPARK_SECONDS * 1000)) * SPARK_W
  const y = (v: number) => SPARK_H - 1 - (v / 100) * (SPARK_H - 2)
  return points.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.cpu!.total).toFixed(1)}`).join('')
}
