import { describe, expect, it } from 'vitest'
import type { TraceRecordOptions } from '@shared/trace'
import { buildTraceConfig, isPackageName } from './traceConfig'

const base: TraceRecordOptions = { preset: 'jank', durationSec: 10, bufferMb: 64, logcat: false, pauseMetrics: true }

describe('isPackageName', () => {
  it('accepts package names and rejects anything else', () => {
    expect(isPackageName('com.example.app')).toBe(true)
    expect(isPackageName('com.example_2.app')).toBe(true)
    expect(isPackageName('example')).toBe(false)
    expect(isPackageName('com.example"; rm -rf /')).toBe(false)
    expect(isPackageName('com.example app')).toBe(false)
  })
})

describe('buildTraceConfig', () => {
  it('sets buffers, duration and streaming to file', () => {
    const config = buildTraceConfig(base, 33)
    expect(config).toContain('size_kb: 65536')
    expect(config).toContain('duration_ms: 10000')
    expect(config).toContain('write_into_file: true')
    expect(config).toContain('ftrace_events: "sched/sched_switch"')
    expect(config).toContain('atrace_apps: "*"')
  })

  it('adds frame timeline only on Android 12+', () => {
    expect(buildTraceConfig(base, 31)).toContain('android.surfaceflinger.frametimeline')
    expect(buildTraceConfig(base, 30)).not.toContain('android.surfaceflinger.frametimeline')
  })

  it('limits atrace to the chosen app and drops invalid names', () => {
    expect(buildTraceConfig({ ...base, app: 'com.example.app' }, 33)).toContain('atrace_apps: "com.example.app"')
    const config = buildTraceConfig({ ...base, app: 'bad"name' }, 33)
    expect(config).not.toContain('bad')
    expect(config).toContain('atrace_apps: "*"')
  })

  it('builds the memory and power presets', () => {
    const memory = buildTraceConfig({ ...base, preset: 'memory' }, 33)
    expect(memory).toContain('lowmemorykiller/lowmemory_kill')
    expect(memory).toContain('proc_stats_poll_ms: 1000')
    expect(memory).toContain('meminfo_counters: MEMINFO_MEM_AVAILABLE')
    const power = buildTraceConfig({ ...base, preset: 'power' }, 33)
    expect(power).toContain('collect_power_rails: true')
    expect(power).toContain('battery_counters: BATTERY_COUNTER_CURRENT')
  })

  it('leaves out fields older Android versions do not know', () => {
    expect(buildTraceConfig(base, 29)).not.toContain('compact_sched')
    expect(buildTraceConfig(base, 29)).not.toContain('record_thread_names')
    expect(buildTraceConfig(base, 30)).toContain('compact_sched')
  })

  it('adds logcat when asked', () => {
    expect(buildTraceConfig({ ...base, logcat: true }, 33)).toContain('android.log')
    expect(buildTraceConfig(base, 33)).not.toContain('android.log')
  })

  it('keeps braces balanced', () => {
    for (const preset of ['jank', 'startup', 'memory', 'power'] as const) {
      const config = buildTraceConfig({ ...base, preset, logcat: true }, 33)
      expect(config.split('{').length).toBe(config.split('}').length)
    }
  })
})
