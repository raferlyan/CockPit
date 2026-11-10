import { DEFAULT_ALERT_RULES, type AlertRules } from '@shared/alerts'
import { t } from '../i18n'
import { thermalStatusLabel } from '../metrics/thresholds'
import { useSettingsStore } from './settingsStore'

type NumericRule = 'cpuTemp' | 'thermalStatus' | 'memoryAvailable' | 'throttle' | 'jank' | 'frameMs'

const ROWS: { key: NumericRule; label: () => string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'cpuTemp', label: () => t('CPU 温度高于'), unit: '°C', min: 30, max: 100, step: 1 },
  { key: 'thermalStatus', label: () => t('温控等级达到'), unit: '', min: 1, max: 6, step: 1 },
  { key: 'memoryAvailable', label: () => t('可用内存低于'), unit: '%', min: 1, max: 50, step: 1 },
  { key: 'throttle', label: () => t('频率上限低于硬件最高的'), unit: '%', min: 10, max: 95, step: 5 },
  { key: 'jank', label: () => t('前台应用卡顿帧高于'), unit: '%', min: 1, max: 90, step: 1 },
  { key: 'frameMs', label: () => t('单帧耗时超过'), unit: 'ms', min: 50, max: 5000, step: 50 }
]

/** 设置里的“告警”分区：每条规则可以单独开关、调阈值，改动立即同步给主进程 */
export function AlertSettings() {
  const rules = useSettingsStore((s) => s.alerts)
  const update = (patch: Partial<AlertRules>) => useSettingsStore.getState().update({ alerts: { ...rules, ...patch } })

  return (
    <>
      <h3 className="status-heading">{t('告警')}</h3>
      <label className="alert-row alert-master">
        <input type="checkbox" checked={rules.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <span>{t('超过阈值时在时间轴上打标记并弹出提示')}</span>
      </label>
      <div className={`alert-rules${rules.enabled ? '' : ' is-off'}`}>
        {ROWS.map((row) => {
          const value = rules[row.key]
          const on = value !== null
          return (
            <div key={row.key} className="alert-row">
              <input
                type="checkbox"
                checked={on}
                disabled={!rules.enabled}
                onChange={(e) => update({ [row.key]: e.target.checked ? DEFAULT_ALERT_RULES[row.key] : null })}
                aria-label={row.label()}
              />
              <span className="alert-label">{row.label()}</span>
              <input
                type="number"
                className="alert-input"
                min={row.min}
                max={row.max}
                step={row.step}
                value={value ?? DEFAULT_ALERT_RULES[row.key] ?? ''}
                disabled={!rules.enabled || !on}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && e.target.value !== '') update({ [row.key]: Math.min(row.max, Math.max(row.min, n)) })
                }}
              />
              <span className="muted alert-unit">{row.key === 'thermalStatus' && value !== null ? thermalStatusLabel(value) : row.unit}</span>
            </div>
          )
        })}
        <label className="alert-row">
          <input type="checkbox" checked={rules.appCrash} disabled={!rules.enabled} onChange={(e) => update({ appCrash: e.target.checked })} />
          <span className="alert-label">{t('关注的应用崩溃或 ANR')}</span>
        </label>
        <div className="alert-row">
          <span />
          <span className="alert-label">{t('温度、内存、限频持续超过')}</span>
          <input
            type="number"
            className="alert-input"
            min={1}
            max={600}
            value={rules.forSeconds}
            disabled={!rules.enabled}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (n >= 1 && n <= 600) update({ forSeconds: n })
            }}
          />
          <span className="muted alert-unit">{t('秒才告警')}</span>
        </div>
        <p className="muted settings-tip">{t('卡顿帧持续 5 秒、温控等级达到即告警；同一条告警一分钟内不重复提示，恢复时在时间轴上记一笔。')}</p>
      </div>
    </>
  )
}
