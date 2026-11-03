import { describe, expect, it } from 'vitest'
import { isPermissionError, listCommand, parseLsOutput, remoteJoin, shellQuote } from './remotePath'

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
