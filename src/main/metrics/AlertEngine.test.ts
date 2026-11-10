import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERT_RULES, normalizeAlertRules } from '@shared/alerts'
import type { FrameStats, LoadSample, MetricsEvent } from '@shared/metrics'
import { AlertEngine } from './AlertEngine'

const load = (sample: Partial<LoadSample>): MetricsEvent => ({ type: 'load', serial: 's', sample: { t: 0, ...sample } })
const frames = (stats: Partial<FrameStats>): MetricsEvent => ({ type: 'frames', serial: 's', stats: { t: 0, pkg: 'com.foo', source: 'hwui', fps: 60, idle: false, ...stats } })

describe('AlertEngine', () => {
  it('fires only after the condition holds for forSeconds, then reports recovery', () => {
    const engine = new AlertEngine()
    const hot = load({ thermal: { cpu: 50 } })
    expect(engine.observe(hot, 0)).toEqual([])
    expect(engine.observe(hot, 9_000)).toEqual([])
    expect(engine.observe(hot, 10_000)).toEqual([{ rule: 'cpuTemp', value: '50.0°C' }])
    // 告警中不重复触发
    expect(engine.observe(hot, 11_000)).toEqual([])
    expect(engine.observe(load({ thermal: { cpu: 40 } }), 12_000)).toEqual([{ rule: 'cpuTemp', value: '40.0°C', resolved: true }])
  })

  it('resets the timer when the condition breaks before forSeconds', () => {
    const engine = new AlertEngine()
    engine.observe(load({ thermal: { cpu: 50 } }), 0)
    engine.observe(load({ thermal: { cpu: 40 } }), 5_000)
    expect(engine.observe(load({ thermal: { cpu: 50 } }), 12_000)).toEqual([])
    expect(engine.observe(load({ thermal: { cpu: 50 } }), 22_000)).toHaveLength(1)
  })

  it('applies the one-minute cooldown after a firing', () => {
    const engine = new AlertEngine()
    const low = load({ memory: { totalKB: 1000, availableKB: 50, swapTotalKB: 0, swapFreeKB: 0 } })
    const ok = load({ memory: { totalKB: 1000, availableKB: 500, swapTotalKB: 0, swapFreeKB: 0 } })
    engine.observe(low, 0)
    expect(engine.observe(low, 10_000)).toEqual([{ rule: 'memoryAvailable', value: '5%' }])
    engine.observe(ok, 11_000)
    engine.observe(low, 12_000)
    expect(engine.observe(low, 30_000)).toEqual([])
    expect(engine.observe(low, 70_000)).toEqual([{ rule: 'memoryAvailable', value: '5%' }])
  })

  it('fires thermal status immediately and checks throttle against the worst cluster', () => {
    const engine = new AlertEngine()
    expect(engine.observe(load({ thermalStatus: 2 }), 0)).toEqual([{ rule: 'thermalStatus', value: '2' }])
    const throttled = load({
      cpu: {
        total: 50,
        cores: [],
        freqMHz: [],
        clusters: [
          { cores: [0], maxMHz: 1800, limitMHz: 1800 },
          { cores: [1], maxMHz: 3200, limitMHz: 1600 }
        ]
      }
    })
    engine.observe(throttled, 0)
    expect(engine.observe(throttled, 10_000)).toContainEqual({ rule: 'throttle', value: '1600 / 3200 MHz' })
  })

  it('uses a shorter window for jank and fires long frames instantly', () => {
    const engine = new AlertEngine()
    engine.observe(frames({ jankRatio: 40 }), 0)
    expect(engine.observe(frames({ jankRatio: 40 }), 5_000)).toEqual([{ rule: 'jank', value: '40% · com.foo' }])
    expect(engine.observe(frames({ jankRatio: 0, worstMs: 450 }), 6_000)).toEqual([
      { rule: 'jank', value: '0% · com.foo', resolved: true },
      { rule: 'frameMs', value: '450 ms · com.foo' }
    ])
    // 画面静止不算卡顿
    engine.observe(frames({ idle: true, jankRatio: undefined }), 7_000)
  })

  it('does nothing when disabled or a rule is off', () => {
    const engine = new AlertEngine()
    engine.setRules({ ...DEFAULT_ALERT_RULES, enabled: false })
    expect(engine.observe(load({ thermalStatus: 5 }), 0)).toEqual([])
    engine.setRules({ ...DEFAULT_ALERT_RULES, thermalStatus: null })
    expect(engine.observe(load({ thermalStatus: 5 }), 0)).toEqual([])
  })
})

describe('normalizeAlertRules', () => {
  it('keeps valid fields and falls back to defaults for the rest', () => {
    expect(normalizeAlertRules({ cpuTemp: 50, jank: null, frameMs: 'x', forSeconds: 0, enabled: false })).toEqual({
      ...DEFAULT_ALERT_RULES,
      cpuTemp: 50,
      jank: null,
      enabled: false
    })
    expect(normalizeAlertRules(null)).toEqual(DEFAULT_ALERT_RULES)
  })
})
