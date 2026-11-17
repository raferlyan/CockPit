import { describe, expect, it } from 'vitest'
import { mirrorWorkspace } from './workspace'

describe('mirror workspace visibility', () => {
  it('shows the focused device mirror in single-device mode', () => {
    expect(mirrorWorkspace('single', 'a', ['a', 'b'])).toEqual({ showMirror: true, showStatus: false })
  })

  it('shows device status when the focused device has no mirror', () => {
    expect(mirrorWorkspace('single', 'b', ['a'])).toEqual({ showMirror: false, showStatus: true })
  })

  it('shows device status when no device is focused', () => {
    expect(mirrorWorkspace('single', null, ['a'])).toEqual({ showMirror: false, showStatus: true })
  })

  it('shows all available mirrors in explicit grid mode', () => {
    expect(mirrorWorkspace('grid', 'b', ['a'])).toEqual({ showMirror: true, showStatus: false })
  })

  it('shows status when grid mode has no mirrors', () => {
    expect(mirrorWorkspace('grid', 'a', [])).toEqual({ showMirror: false, showStatus: true })
  })
})
