import { describe, expect, it } from 'vitest'
import { suggest, type CompletionContext } from './completion'

const ctx: CompletionContext = { history: [], packages: ['com.android.settings', 'com.example.app', 'com.tencent.mm'] }
const labels = (line: string, c = ctx) => suggest(line, c).map((s) => s.label)

describe('suggest', () => {
  it('completes top-level commands', () => {
    expect(labels('dump')).toEqual(['dumpsys'])
    expect(suggest('dump', ctx)[0]).toMatchObject({ deleteCount: 0, insert: 'sys ' })
  })

  it('walks into subcommands', () => {
    expect(labels('pm li')).toEqual(['list'])
    expect(labels('pm list pa')).toEqual(['packages'])
    expect(labels('pm list packages -')).toContain('-3')
  })

  it('suggests package names, including substring matches', () => {
    expect(labels('am force-stop com.ex')).toEqual(['com.example.app'])
    const [match] = suggest('pm clear tencent', ctx)
    expect(match).toMatchObject({ label: 'com.tencent.mm', deleteCount: 7, insert: 'com.tencent.mm ' })
  })

  it('suggests option arguments', () => {
    expect(labels('monkey -p com.and')).toEqual(['com.android.settings'])
    expect(labels('logcat -b cr')).toEqual(['crash'])
  })

  it('suggests fixed values', () => {
    expect(labels('input keyevent KEYCODE_HO')).toEqual(['KEYCODE_HOME'])
    expect(labels('getprop ro.build.version.s')).toEqual(['ro.build.version.sdk'])
  })

  it('starts over after a pipe', () => {
    expect(labels('ps -A | gr')).toEqual(['grep'])
  })

  it('puts matching history first', () => {
    const withHistory = { ...ctx, history: ['dumpsys battery', 'ls /sdcard'] }
    expect(labels('dumps', withHistory)).toEqual(['dumpsys battery', 'dumpsys'])
  })

  it('returns nothing for an empty line or an exact match', () => {
    expect(labels('')).toEqual([])
    expect(labels('ls')).toEqual([])
  })
})
