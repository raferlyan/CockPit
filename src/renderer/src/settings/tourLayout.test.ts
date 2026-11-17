import { describe, expect, it } from 'vitest'
import { tourCollapsed } from './tourLayout'

const defaults = { sidebar: false, side: false, terminal: true }

describe('tour pane overrides', () => {
  it('preserves the saved layout on steps without a pane target', () => {
    expect(tourCollapsed(defaults, undefined)).toEqual(defaults)
  })

  it('temporarily opens only the terminal for the terminal step', () => {
    expect(tourCollapsed({ sidebar: true, side: true, terminal: true }, 'terminal-actions')).toEqual({ sidebar: true, side: true, terminal: false })
  })

  it('temporarily opens the side pane for device actions', () => {
    expect(tourCollapsed({ sidebar: true, side: true, terminal: true }, 'btn-mirror')).toEqual({ sidebar: true, side: false, terminal: true })
  })
})
