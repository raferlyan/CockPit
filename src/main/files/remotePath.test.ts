import { describe, expect, it } from 'vitest'
import { parseLsOutput, remoteJoin, shellQuote } from './remotePath'

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
