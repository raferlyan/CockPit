import { useEffect, useState } from 'react'
import {
  TRACE_BUFFER_OPTIONS_MB,
  TRACE_MAX_DURATION_SEC,
  TRACE_PRESETS,
  type TracePreset,
  type TraceRecordEvent,
  type TraceRecordOptions,
  type TraceRecordState
} from '@shared/trace'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { isRecordingActive, presetLabel, useTraceStore } from './traceStore'
import { t } from '../i18n'

const STORAGE_KEY = 'cockpit.trace.last'
const DEFAULTS: TraceRecordOptions = { preset: 'jank', durationSec: 10, bufferMb: 64, logcat: true, pauseMetrics: true }

/** 记住上次的录制参数；存储不可用时用默认值 */
function loadLast(): TraceRecordOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<TraceRecordOptions> | null
    const merged = { ...DEFAULTS, ...saved }
    return TRACE_PRESETS.some((p) => p.id === merged.preset) ? merged : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

function saveLast(options: TraceRecordOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // 忽略：只是便利功能
  }
}

const STATE_LABEL = (): Record<TraceRecordState, string> => ({
  starting: t('正在准备…'),
  recording: t('录制中'),
  stopping: t('正在结束，等待 perfetto 写完文件…'),
  pulling: t('正在拉取到本机…'),
  done: t('已完成'),
  error: t('失败')
})

/** 录制系统 trace：选预设、时长和应用，录完自动在内嵌的 Perfetto 中打开 */
export function RecordTraceDialog({ serial }: { serial: string }) {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const recording = useTraceStore((s) => s.recordings[serial])
  const close = () => useTraceStore.getState().openDialog(null)
  const active = isRecordingActive(recording)

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog trace-dialog" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2 className="panel-title">
          {t('录制 Trace')} · {device ? deviceTitle(device) : serial}
        </h2>
        {active && recording ? <Progress recording={recording} onClose={close} /> : <RecordForm serial={serial} onClose={close} />}
      </div>
    </div>
  )
}

function RecordForm({ serial, onClose }: { serial: string; onClose(): void }) {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const [options, setOptions] = useState(loadLast)
  const [packages, setPackages] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const preset = TRACE_PRESETS.find((p) => p.id === options.preset) ?? TRACE_PRESETS[0]
  const set = <K extends keyof TraceRecordOptions>(key: K, value: TraceRecordOptions[K]) => setOptions((o) => ({ ...o, [key]: value }))
  const sdk = device?.info?.sdk

  useEffect(() => {
    let alive = true
    api.devices.packages(serial).then(
      (list) => alive && setPackages(list),
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [serial])

  const choosePreset = (id: TracePreset) => {
    const next = TRACE_PRESETS.find((p) => p.id === id)
    if (next) setOptions((o) => ({ ...o, preset: id, durationSec: next.defaultDurationSec }))
  }

  const app = options.app?.trim() ?? ''
  const durationValid = Number.isInteger(options.durationSec) && options.durationSec >= 1 && options.durationSec <= TRACE_MAX_DURATION_SEC
  const disabledReason =
    (device?.state !== 'device' && t('设备不在线')) ||
    (!sdk && t('还没读到设备的 Android 版本')) ||
    (sdk !== undefined && sdk < 29 && t('录制需要 Android 10 及以上，这台设备是 API {sdk}', { sdk })) ||
    (starting && t('正在启动录制')) ||
    (!durationValid && t('时长需要是 1–{max} 之间的整数秒', { max: TRACE_MAX_DURATION_SEC })) ||
    (preset.app === 'required' && !app && t('先选择要启动的应用'))

  const submit = async () => {
    const finalOptions: TraceRecordOptions = { ...options, app: preset.app === 'none' ? undefined : app || undefined }
    setStarting(true)
    try {
      await api.trace.record(serial, finalOptions, device ? deviceTitle(device) : serial)
      saveLast({ ...finalOptions, app: app || undefined })
    } catch (error) {
      notify('error', t('无法开始录制'), errorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (disabledReason) notify('info', disabledReason)
        else void submit()
      }}
    >
      <div className="trace-presets">
        {TRACE_PRESETS.map((p) => (
          <button type="button" key={p.id} className={`trace-preset${p.id === preset.id ? ' on' : ''}`} onClick={() => choosePreset(p.id)}>
            <strong>{t(p.label)}</strong>
            <span>{t(p.description)}</span>
          </button>
        ))}
      </div>

      {preset.app !== 'none' && (
        <label className="field">
          <span>{preset.app === 'required' ? t('要冷启动的应用') : t('只抓这个应用的 atrace 埋点（留空为全部应用）')}</span>
          <input
            className="mono"
            list="trace-packages"
            value={options.app ?? ''}
            placeholder="com.example.app"
            onChange={(e) => set('app', e.target.value)}
            spellCheck={false}
          />
          <datalist id="trace-packages">
            {packages.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
      )}

      <div className="field-grid trace-grid">
        <label className="field">
          <span>{t('时长（秒）')}</span>
          <input
            type="number"
            min={1}
            max={TRACE_MAX_DURATION_SEC}
            value={Number.isNaN(options.durationSec) ? '' : options.durationSec}
            onChange={(e) => set('durationSec', e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>{t('缓冲区')}</span>
          <select value={options.bufferMb} onChange={(e) => set('bufferMb', Number(e.target.value))}>
            {TRACE_BUFFER_OPTIONS_MB.map((mb) => (
              <option key={mb} value={mb}>
                {mb} MB
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-checks">
        <label>
          <input type="checkbox" checked={options.logcat} onChange={(e) => set('logcat', e.target.checked)} /> {t('同时记录 logcat')}
        </label>
        <label title={t(t('Cockpit 每秒在设备上执行 shell 命令采集状态，这些命令会出现在 trace 里'))}>
          <input type="checkbox" checked={options.pauseMetrics} onChange={(e) => set('pauseMetrics', e.target.checked)} /> {t('录制期间暂停这台设备的状态采集')}
        </label>
      </div>
      {sdk !== undefined && sdk < 31 && (preset.id === 'jank' || preset.id === 'startup') && (
        <p className="hint">{t('这台设备低于 Android 12，没有 SurfaceFlinger 帧时间线，卡顿帧需要从渲染线程的 atrace 里看。')}</p>
      )}
      <p className="trace-note">{t('投屏也会占用 CPU 和 GPU，分析卡顿或功耗时建议先停止投屏。')}</p>

      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t(t('取消'))}
        </button>
        <ActionButton type="submit" className="primary" disabledReason={disabledReason}>
          {starting ? t('正在启动…') : t('开始录制')}
        </ActionButton>
      </div>
    </form>
  )
}

function Progress({ recording, onClose }: { recording: TraceRecordEvent; onClose(): void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  // now 每 250ms 才更新一次，刚开始时可能还早于 startedAt
  const elapsed = recording.startedAt ? Math.min(Math.max(0, now - recording.startedAt), recording.durationMs) : 0
  const percent = recording.state === 'recording' ? (elapsed / recording.durationMs) * 100 : recording.state === 'starting' ? 0 : 100
  const canStop = recording.state === 'starting' || recording.state === 'recording'

  return (
    <div className="trace-progress">
      <div className="upload-progress-head">
        <span>
          {presetLabel(recording.preset)} · {STATE_LABEL()[recording.state]}
        </span>
        {recording.state === 'recording' && (
          <span className="mono">
            {t('{a} / {b} 秒', { a: Math.floor(elapsed / 1000), b: recording.durationMs / 1000 })}
          </span>
        )}
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${percent}%` }} />
      </div>
      {recording.message && <p className="trace-note">{recording.message}</p>}
      <p className="trace-note">{t('录制在后台进行，可以关掉这个窗口继续操作手机；录完会自动在 Perfetto 中打开。')}</p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t(t('后台继续'))}
        </button>
        <ActionButton
          className="primary"
          disabledReason={!canStop && t('正在收尾，请稍候')}
          onClick={() => void api.trace.stopRecord(recording.serial)}
        >
          {recording.state === 'starting' ? t('取消') : t('结束录制')}
        </ActionButton>
      </div>
    </div>
  )
}
