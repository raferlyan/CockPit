import { describe, expect, it } from 'vitest'
import { SessionKeys } from './session'
import { CommandHistory } from './history'

describe('Windows Terminal ADB input', () => {
  function fixture() {
    const history = new CommandHistory(':memory:')
    const sent: string[] = []
    const keys = new SessionKeys(history, data => sent.push(data))
    return { history, sent, keys }
  }
  it('accepts a live package substring without executing it', () => {
    const { keys, sent } = fixture()
    keys.packages = ['com.android.settings']
    keys.input('settings', 'pm path ')
    expect(keys.candidate('pm path settings')?.label).toBe('com.android.settings')
    keys.input('\t', 'pm path settings')
    expect(sent.at(-1)).toBe('\x7f'.repeat(8) + 'com.android.settings ')
  })
  it('recalls a command before device echo and restores the draft', () => {
    const { history, keys, sent } = fixture()
    history.record('pwd')
    keys.input('\x1b[A', 'cd')
    keys.input('\x1b[B', 'cd')
    expect(sent).toEqual(['\x7f\x7fpwd','\x7f\x7f\x7fcd'])
  })
  it('passes foreground keys through and never records a password prompt', () => {
    const { history, keys, sent } = fixture()
    for (const key of ['s', '\t', '\x1b[A', '\r']) keys.input(key, null)
    expect(sent.join('')).toBe('s\t\x1b[A\r')
    expect(history.list()).toEqual([])
  })
  it('saves once per command and moves a repeated entry to the top', () => {
    const { history, keys } = fixture()
    for (const line of ['pwd','id','pwd']) keys.input('\r', line)
    expect(history.list()).toEqual(['pwd','id'])
  })
})
