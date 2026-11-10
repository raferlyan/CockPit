import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MetricsEvent } from '@shared/metrics'
import { MetricsRecorder } from './MetricsRecorder'

describe('MetricsRecorder', () => {
  let dir: string
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('records only the recording device, then reads the session back', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cockpit-metrics-'))
    const notified: MetricsEvent[] = []
    const recorder = new MetricsRecorder(
      dir,
      () => 'Pixel 8',
      (e) => notified.push(e),
      async () => undefined,
      (serial) => [{ type: 'foreground', serial, foreground: { pkg: 'com.foo', activity: 'com.foo.Main' } }]
    )

    const state = await recorder.start('abc')
    expect(state.path.startsWith(dir)).toBe(true)
    expect(recorder.status()).toEqual({ abc: state })
    recorder.write({ type: 'load', serial: 'abc', sample: { t: 1, cpu: { total: 10, cores: [], freqMHz: [] } } })
    recorder.write({ type: 'load', serial: 'other', sample: { t: 2 } })
    recorder.write({ type: 'processes', serial: 'abc', processes: [] })
    recorder.write({ type: 'marker', serial: 'abc', marker: { id: 1, t: 3, kind: 'manual', label: '' } })
    const file = await recorder.stop('abc')
    expect(file?.name).toMatch(/^Pixel_8_\d{8}-\d{6}\.ndjson$/)
    expect(notified.map((e) => e.type === 'recording' && e.recording)).toEqual([state, null])

    // 异常退出时最后一行可能只写了一半
    await appendFile(state.path, '{"type":"load","serial":"abc","sam')
    const session = await recorder.load(state.path)
    expect(session).toMatchObject({ serial: 'abc', device: 'Pixel 8', history: [{ t: 1 }], markers: [{ id: 1 }], foreground: { pkg: 'com.foo' } })
    expect(await recorder.list()).toHaveLength(1)
  })

  it('refuses paths outside the recording directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cockpit-metrics-'))
    const recorder = new MetricsRecorder(dir, () => undefined, () => undefined, async () => undefined)
    await expect(recorder.load(join(dir, '..', 'x.ndjson'))).rejects.toThrow()
    await expect(recorder.load(join(dir, 'x.txt'))).rejects.toThrow()
    await expect(recorder.remove('/etc/passwd')).rejects.toThrow()
  })
})
