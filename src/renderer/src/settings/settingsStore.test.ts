import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved = new Map<string, string>()

beforeEach(() => {
  saved.clear()
  vi.resetModules()
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value)
  })
  vi.stubGlobal('window', { cockpit: {} })
})

describe('pane collapse defaults', () => {
  it('starts a fresh layout with only the terminal collapsed', async () => {
    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().collapsed).toEqual({ sidebar: false, side: false, terminal: true })
  })

  it('keeps an existing saved terminal preference', async () => {
    saved.set('cockpit.settings', JSON.stringify({ collapsed: { sidebar: true, side: false, terminal: false } }))

    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().collapsed).toEqual({ sidebar: true, side: false, terminal: false })
  })
})
