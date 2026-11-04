import { describe, expect, it } from 'vitest'
import { DU_SEP, isPermissionError, listCommand, parseDiskUsage, parseLsOutput, remoteJoin, shellQuote } from './remotePath'

describe('remotePath', () => {
  it('parses ls -1pa output with directories first', () => {
    expect(parseLsOutput('./\r\n../\r\nb.txt\r\nDownload/\r\na b.png\r\n.hidden/\r\n')).toEqual([
      { name: '.hidden', dir: true },
      { name: 'Download', dir: true },
      { name: 'a b.png', dir: false },
      { name: 'b.txt', dir: false }
    ])
  })

  it('quotes single quotes for the device shell', () => {
    expect(shellQuote("it's here")).toBe(`'it'\\''s here'`)
  })

  it('joins remote paths without doubling slashes', () => {
    expect(remoteJoin('/sdcard/Download/', 'a.apk')).toBe('/sdcard/Download/a.apk')
    expect(remoteJoin('/', 'a.apk')).toBe('/a.apk')
  })
})

describe('listCommand', () => {
  it('marks symlinked directories with [ -d ] instead of ls -p', () => {
    const cmd = listCommand("/it's")
    expect(cmd).toContain(`cd '/it'\\''s'`)
    expect(cmd).toContain('[ -d "$f" ]')
  })

  it('recognizes permission errors', () => {
    expect(isPermissionError("adb: error: failed to stat remote object '/data/x': Permission denied")).toBe(true)
    expect(isPermissionError('No such file or directory')).toBe(false)
  })
})

describe('parseDiskUsage', () => {
  it('reads du -akd 1 output, sorts by size and marks directories', () => {
    const out = ['12\t./a.txt', '2048\t./Android', 'du: ./secret: Permission denied', '4096\t./DCIM', '6200\t.', DU_SEP, 'Android', 'DCIM', 'secret'].join('\n')
    const usage = parseDiskUsage('/sdcard', out, false)
    expect(usage.totalKB).toBe(6200)
    expect(usage.partial).toBe(true)
    expect(usage.entries).toEqual([
      { name: 'DCIM', sizeKB: 4096, dir: true },
      { name: 'Android', sizeKB: 2048, dir: true },
      { name: 'a.txt', sizeKB: 12, dir: false },
      { name: 'secret', sizeKB: 0, dir: true }
    ])
  })

  it('sums entries when the fallback du -sk gives no total line', () => {
    const usage = parseDiskUsage('/data', ['10\tapp', '5\tlocal', DU_SEP, 'app', 'local'].join('\n'), true)
    expect(usage.totalKB).toBe(15)
    expect(usage.root).toBe(true)
    expect(usage.partial).toBe(false)
  })
})
