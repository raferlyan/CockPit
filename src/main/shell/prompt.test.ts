import { describe, expect, it } from 'vitest'
import { detectIdentity } from './prompt'

describe('detectIdentity', () => {
  it.each([
    ['OnePlus7Pro:/ $ ', 'user'],
    ['ls\r\nfoo\r\nOnePlus7Pro:/data # ', 'root'],
    ['\x1b[1;32mhost:/sdcard $\x1b[0m ', 'user'],
    ['# ', 'root'],
    ['echo $HOME\r\n', undefined],
    ['price is 5 $', undefined],
    ['OnePlus7Pro:/ $ ls', undefined]
  ] as const)('%j → %s', (tail, expected) => {
    expect(detectIdentity(tail)).toBe(expected)
  })
})
