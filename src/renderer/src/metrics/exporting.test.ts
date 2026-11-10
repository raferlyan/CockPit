import { describe, expect, it, vi } from 'vitest'

// markers.ts 引用 api（preload 暴露的 window.cockpit），单测里给一个空壳
vi.mock('../api', () => ({ api: { platform: 'darwin', metrics: {} } }))

const { buildCsv, buildJson, exportFileName, sliceExport } = await import('./exporting')

const base = {
  device: 'Pixel 8',
  serial: 'abc',
  history: [
    { t: 1000, cpu: { total: 12.345, cores: [10, null], freqMHz: [1800, null], iowait: 1 }, memory: { totalKB: 4096, availableKB: 1024, swapTotalKB: 0, swapFreeKB: 0 } },
    { t: 2000, cpu: { total: 50, cores: [60, 40], freqMHz: [2400, 1200] }, thermal: { cpu: 41.26 } },
    { t: 9000, cpu: { total: 99, cores: [99, 99], freqMHz: [3000, 3000] } }
  ],
  appHistory: [{ t: 2010, pkg: 'com.foo', pids: [1], cpu: 5.56, rssKB: 2048 }],
  frameHistory: [{ t: 1990, pkg: 'com.foo', source: 'hwui' as const, fps: 58, idle: false, jankRatio: 3.3, p90: 20 }],
  markers: [{ id: 1, t: 2100, kind: 'manual' as const, label: 'a, "b"' }]
}

describe('export', () => {
  it('slices by time range and builds per-second CSV rows with merged app, frame and event columns', () => {
    const data = sliceExport(base, 0, 5000)
    expect(data.history).toHaveLength(2)
    const csv = buildCsv(data)
    expect(csv.startsWith('﻿')).toBe(true)
    const [header, first, second] = csv.slice(1).trim().split('\r\n')
    const col = (row: string, name: string) => row.split(',')[header.split(',').indexOf(name)]
    expect(header.split(',')).toContain('cpu1_mhz')
    expect(col(first, 'cpu_pct')).toBe('12.3')
    expect(col(first, 'cpu1_pct')).toBe('')
    expect(col(first, 'mem_used_pct')).toBe('75')
    expect(col(second, 'temp_cpu_c')).toBe('41.3')
    expect(col(second, 'app')).toBe('com.foo')
    expect(col(second, 'app_cpu_pct')).toBe('5.6')
    expect(col(second, 'fps')).toBe('58')
    // 事件列里有逗号和引号，按 CSV 规则加引号转义
    expect(second.endsWith('"Marker: a, ""b"""') || second.endsWith('"标记：a, ""b"""')).toBe(true)
  })

  it('names files after the device and start time, and keeps raw data in JSON', () => {
    const data = sliceExport(base, 0, 5000)
    expect(exportFileName(data, 'csv')).toMatch(/^Pixel_8_\d{8}-\d{6}\.csv$/)
    expect(JSON.parse(buildJson(data))).toMatchObject({ format: 'cockpit-metrics', serial: 'abc', from: 0, to: 5000 })
  })
})
