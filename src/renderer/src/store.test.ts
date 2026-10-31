import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/models'

vi.stubGlobal('window', { cockpit: { platform: 'darwin' } })
let store: typeof import('./store')
beforeAll(async () => {
  store = await import('./store')
})

const device = (serial: string, state: Device['state'] = 'device'): Device => ({ serial, state, connection: 'usb', root: 'unknown' })
const state = () => store.useAppStore.getState()

beforeEach(() => {
  store.useAppStore.setState({ devices: [], focusedSerial: null, mirrorTiles: [], mirrorLayout: 'grid' })
})

describe('mirror tiles', () => {
  it('adds the first online device as a tile and keeps tiles when focus moves', () => {
    state().setDevices([device('a'), device('b')])
    expect(state().focusedSerial).toBe('a')
    expect(state().mirrorTiles).toEqual(['a'])
    state().focus('b')
    expect(state().mirrorTiles).toEqual(['a', 'b'])
  })

  it('does not re-add a tile the user closed on later device updates', () => {
    state().setDevices([device('a')])
    state().removeTile('a')
    state().setDevices([device('a')])
    expect(state().mirrorTiles).toEqual([])
  })

  it('adds the focused device once it comes online, and drops unplugged devices', () => {
    state().setDevices([device('a', 'unauthorized')])
    expect(state().mirrorTiles).toEqual([])
    state().setDevices([device('a')])
    expect(state().mirrorTiles).toEqual(['a'])
    state().setDevices([device('b')])
    expect(state().mirrorTiles).toEqual(['b'])
  })

  it('caps the number of tiles', () => {
    state().setDevices(['a', 'b', 'c', 'd', 'e'].map((s) => device(s)))
    for (const s of ['b', 'c', 'd', 'e']) state().addTile(s)
    expect(state().mirrorTiles).toEqual(['a', 'b', 'c', 'd'])
    // 满了以后切换焦点也不会自动加入
    state().focus('e')
    expect(state().mirrorTiles).toHaveLength(store.MAX_MIRROR_TILES)
  })

  it('moves focus to a remaining tile when closing the shown tile in single layout', () => {
    state().setDevices([device('a'), device('b')])
    state().addTile('b')
    state().setMirrorLayout('single')
    state().removeTile('b')
    expect(state().focusedSerial).toBe('a')
  })
})
