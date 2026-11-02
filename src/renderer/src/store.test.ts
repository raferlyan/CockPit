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
  it('does not mirror automatically; tiles are added on demand and survive focus changes', () => {
    state().setDevices([device('a'), device('b')])
    expect(state().focusedSerial).toBe('a')
    expect(state().mirrorTiles).toEqual([])
    state().addTile('a')
    state().focus('b')
    expect(state().mirrorTiles).toEqual(['a'])
    expect(state().focusedSerial).toBe('b')
  })

  it('drops unplugged devices and keeps offline ones', () => {
    state().setDevices([device('a'), device('b')])
    state().addTile('a')
    state().addTile('b')
    state().setDevices([device('a', 'offline')])
    expect(state().mirrorTiles).toEqual(['a'])
  })

  it('closes all tiles at once', () => {
    state().setDevices([device('a'), device('b')])
    state().addTile('a')
    state().addTile('b')
    state().closeMirrors()
    expect(state().mirrorTiles).toEqual([])
  })

  it('caps the number of tiles', () => {
    state().setDevices(['a', 'b', 'c', 'd', 'e'].map((s) => device(s)))
    for (const s of ['a', 'b', 'c', 'd', 'e']) state().addTile(s)
    expect(state().mirrorTiles).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves focus to a remaining tile when closing the shown tile in single layout', () => {
    state().setDevices([device('a'), device('b')])
    state().addTile('a')
    state().addTile('b')
    state().setMirrorLayout('single')
    state().removeTile('b')
    expect(state().focusedSerial).toBe('a')
  })
})
