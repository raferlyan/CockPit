import { describe, expect, it } from 'vitest'
import { isInjectableText, metaStateOf, shouldSendAsKeycode, toAndroidKeycode } from './keyboard'

const mods = { ctrlKey: false, altKey: false, metaKey: false }

describe('keyboard mapping', () => {
  it('maps codes to Android keycodes', () => {
    expect(toAndroidKeycode('KeyA')).toBe(29)
    expect(toAndroidKeycode('KeyZ')).toBe(54)
    expect(toAndroidKeycode('Digit0')).toBe(7)
    expect(toAndroidKeycode('F12')).toBe(142)
    expect(toAndroidKeycode('Enter')).toBe(66)
    expect(toAndroidKeycode('Unknown')).toBeUndefined()
  })

  it('routes printable keys to text input unless modified', () => {
    expect(shouldSendAsKeycode({ code: 'KeyA', ...mods })).toBe(false)
    expect(shouldSendAsKeycode({ code: 'KeyA', ...mods, ctrlKey: true })).toBe(true)
    expect(shouldSendAsKeycode({ code: 'Backspace', ...mods })).toBe(true)
    expect(shouldSendAsKeycode({ code: 'Space', ...mods })).toBe(false)
  })

  it('computes meta state', () => {
    expect(metaStateOf({ shiftKey: true, altKey: false, ctrlKey: true, metaKey: false })).toBe(0x1 | 0x40 | 0x1000 | 0x2000)
  })

  it('detects text that needs clipboard paste', () => {
    expect(isInjectableText('Hello, world!')).toBe(true)
    expect(isInjectableText('你好')).toBe(false)
  })
})
