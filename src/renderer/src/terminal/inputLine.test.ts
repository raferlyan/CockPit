import { describe, expect, it } from 'vitest'
import { extractCommand } from './inputLine'

describe('extractCommand', () => {
  it('takes the text after an Android prompt', () => {
    expect(extractCommand('walleye:/ $ dumpsys bat')).toBe('dumpsys bat')
    expect(extractCommand('walleye:/data # ls ')).toBe('ls ')
    expect(extractCommand('root@device:/ # pm')).toBe('pm')
    expect(extractCommand('$ ')).toBe('')
    // 上一条命令失败时 mksh 会在提示符前加退出码
    expect(extractCommand('127|walleye:/ $ pm cl')).toBe('pm cl')
  })

  it('returns null without a prompt', () => {
    expect(extractCommand('Password:')).toBeNull()
    expect(extractCommand('  PID USER')).toBeNull()
  })
})
