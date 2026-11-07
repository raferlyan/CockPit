import { describe, expect, it } from 'vitest'
import { HistoryNav } from './historyNav'

const nav = (history = ['newest', 'mid', 'oldest']) => new HistoryNav(() => history)

describe('HistoryNav', () => {
  it('walks from newest to oldest, replacing what is on the line', () => {
    const n = nav()
    expect(n.up('')).toEqual({ deleteCount: 0, insert: 'newest' })
    expect(n.up('ignored while active')).toEqual({ deleteCount: 6, insert: 'mid' })
    expect(n.up('')).toEqual({ deleteCount: 3, insert: 'oldest' })
    expect(n.text).toBe('oldest')
  })

  it('stops at the oldest entry', () => {
    const n = nav(['only'])
    n.up('')
    expect(n.up('')).toEqual({ deleteCount: 0, insert: '' })
    expect(n.text).toBe('only')
  })

  it('restores the draft when coming back down', () => {
    const n = nav()
    expect(n.up('ls /sd')).toEqual({ deleteCount: 6, insert: 'newest' })
    n.up('')
    expect(n.down()).toEqual({ deleteCount: 3, insert: 'newest' })
    expect(n.down()).toEqual({ deleteCount: 6, insert: 'ls /sd' })
    expect(n.active).toBe(false)
    expect(n.down()).toBeNull()
  })

  it('does nothing without history, so the key can go to the shell', () => {
    expect(nav([]).up('x')).toBeNull()
  })

  it('counts characters, not UTF-16 units', () => {
    const n = nav(['a😀', 'b'])
    n.up('')
    expect(n.up('')).toEqual({ deleteCount: 2, insert: 'b' })
  })

  it('keeps its list stable while walking even if history changes', () => {
    const history = ['a', 'b']
    const n = new HistoryNav(() => history)
    n.up('')
    history.unshift('new')
    expect(n.up('')).toEqual({ deleteCount: 1, insert: 'b' })
  })

  it('starts over after reset', () => {
    const n = nav()
    n.up('')
    n.reset()
    expect(n.active).toBe(false)
    expect(n.up('')).toEqual({ deleteCount: 0, insert: 'newest' })
  })
})
