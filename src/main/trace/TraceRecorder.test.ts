import { describe, expect, it } from 'vitest'
import { perfettoError, recordedWindow } from './TraceRecorder'

describe('perfettoError', () => {
  it('reports config parse errors', () => {
    const stderr = `-:82:25 error: Unexpected value 'BATTERY_COUNTER_VOLTAGE' for enum field battery_counters in proto AndroidPowerConfig
      battery_counters: BATTERY_COUNTER_VOLTAGE
[222.183] perfetto_cmd.cc:522     The trace config is invalid, bailing out.`
    expect(perfettoError(stderr)).toBe("配置无效：Unexpected value 'BATTERY_COUNTER_VOLTAGE' for enum field battery_counters in proto AndroidPowerConfig")
  })

  it('explains a missing traced service', () => {
    expect(perfettoError('[1.0] perfetto_cmd.cc:100 Could not connect to the traced socket')).toContain('traced')
  })

  it('falls back to the last perfetto line without the prefix', () => {
    expect(perfettoError('[1.0] perfetto_cmd.cc:792     Connected to the Perfetto traced service, TTL: 3s\n[2.0] perfetto_cmd.cc:600     Failed to start tracing')).toBe(
      'Failed to start tracing'
    )
  })

  it('returns undefined for normal output', () => {
    expect(perfettoError('')).toBeUndefined()
  })
})

describe('recordedWindow', () => {
  it('converts uptime seconds to boottime nanoseconds, trimming both edges', () => {
    expect(recordedWindow('1117435.87', '1117446.02')).toEqual({ start: '1117436370000000', end: '1117445520000000' })
  })

  it('ignores missing or reversed readings', () => {
    expect(recordedWindow(undefined, '10.00')).toBeUndefined()
    expect(recordedWindow('10.00', '10.90')).toBeUndefined()
    expect(recordedWindow('abc', '20.00')).toBeUndefined()
  })
})
