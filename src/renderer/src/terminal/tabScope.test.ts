import { describe, expect, it } from 'vitest'
import { activeAfterClose, activeTabId, replaceActive, visibleTabs } from './tabScope'

const tabs = [
  { id: 'a1', serial: 'A' },
  { id: 'b1', serial: 'B' },
  { id: 'local', serial: '' },
  { id: 'a2', serial: 'A' }
]
const ids = (list: { id: string }[]) => list.map((tab) => tab.id)

describe('terminal tab scope', () => {
  it('shows only the focused device tabs, plus local and serial ones', () => {
    expect(ids(visibleTabs(tabs, 'A'))).toEqual(['a1', 'local', 'a2'])
    expect(ids(visibleTabs(tabs, 'B'))).toEqual(['b1', 'local'])
    expect(ids(visibleTabs(tabs, null))).toEqual(['local'])
  })

  it('remembers the tab each device was on', () => {
    const activeBy = { A: 'a1', B: 'b1' }
    expect(activeTabId(tabs, 'A', activeBy)).toBe('a1')
    expect(activeTabId(tabs, 'B', activeBy)).toBe('b1')
  })

  it('falls back to the last visible tab, never to another device', () => {
    expect(activeTabId(tabs, 'A', {})).toBe('a2')
    expect(activeTabId(tabs, 'A', { A: 'b1' })).toBe('a2')
    expect(activeTabId([{ id: 'b1', serial: 'B' }], 'A', {})).toBeNull()
  })

  it('moves to a neighbor on the same device after closing', () => {
    expect(activeAfterClose(tabs, 'a1', { A: 'a1', B: 'b1' })).toEqual({ A: 'local', B: 'b1' })
    expect(activeAfterClose(tabs, 'a2', { A: 'a2' })).toEqual({ A: 'local' })
  })

  it('forgets the entry when a device has no tabs left', () => {
    expect(activeAfterClose([{ id: 'b1', serial: 'B' }], 'b1', { B: 'b1' })).toEqual({})
  })

  it('handles a shared tab remembered by several devices', () => {
    expect(activeAfterClose(tabs, 'local', { A: 'local', B: 'local' })).toEqual({ A: 'a2', B: 'b1' })
  })

  it('follows a reopened tab to its new id', () => {
    expect(replaceActive({ A: 'old', B: 'b1' }, 'old', 'new')).toEqual({ A: 'new', B: 'b1' })
  })
})
