import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { TraceLibrary } from './TraceLibrary'

const dir = mkdtempSync(join(tmpdir(), 'cockpit-traces-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('TraceLibrary', () => {
  it('lists trace files newest first and skips other files', async () => {
    writeFileSync(join(dir, 'old.pftrace'), 'a')
    writeFileSync(join(dir, 'new.perfetto-trace'), 'bb')
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, '.hidden.pftrace'), 'x')
    utimesSync(join(dir, 'old.pftrace'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    const files = await new TraceLibrary(dir, async () => undefined).list()
    expect(files.map((f) => f.name)).toEqual(['new.perfetto-trace', 'old.pftrace'])
    expect(files[0].size).toBe(2)
  })

  it('returns an empty list when the directory does not exist', async () => {
    expect(await new TraceLibrary(join(dir, 'missing'), async () => undefined).list()).toEqual([])
  })

  it('only trashes files inside its directory', async () => {
    const trash = vi.fn(async () => undefined)
    const library = new TraceLibrary(dir, trash)
    await library.remove(join(dir, 'old.pftrace'))
    expect(trash).toHaveBeenCalledWith(join(dir, 'old.pftrace'))
    await expect(library.remove(join(dir, '..', 'etc.pftrace'))).rejects.toThrow()
    await expect(library.remove(dir)).rejects.toThrow()
  })

  it('builds file names from device label, preset and time', () => {
    const name = new TraceLibrary(dir, async () => undefined).fileName('OnePlus GM1910', 'jank', new Date(2026, 10, 3, 22, 15, 30))
    expect(name).toBe('OnePlus_GM1910_jank_20261103_221530.pftrace')
  })
})
