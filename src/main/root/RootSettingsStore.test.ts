import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RootSettingsStore, type SecretCodec } from './RootSettingsStore'

const codec: SecretCodec = {
  available: () => true,
  encrypt: (text) => Buffer.from(`enc:${text}`).toString('base64'),
  decrypt: (data) => Buffer.from(data, 'base64').toString().replace(/^enc:/, '')
}

describe('RootSettingsStore', () => {
  it('saves an encrypted password and never returns it', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'cockpit-root-')), 'root.json')
    const store = new RootSettingsStore(file, codec)
    const saved = await store.update({ defaultMethod: 'challenge', password: 'p@ss', deviceMethods: { X: 'password' }, toolPath: ' /t/decrypt ' })
    expect(saved).toMatchObject({ defaultMethod: 'challenge', hasPassword: true, toolPath: '/t/decrypt' })
    expect(saved).not.toHaveProperty('password')
    expect(await readFile(file, 'utf8')).not.toContain('p@ss')

    const reloaded = new RootSettingsStore(file, codec)
    expect(reloaded.password()).toBe('p@ss')
    expect(reloaded.methodFor('X')).toBe('password')
    expect(reloaded.methodFor('Y')).toBe('challenge')

    await reloaded.update({ password: '' })
    expect(reloaded.get().hasPassword).toBe(false)
  })

  it('rejects an invalid challenge pattern', async () => {
    const store = new RootSettingsStore(join(await mkdtemp(join(tmpdir(), 'cockpit-root-')), 'r.json'), codec)
    await expect(store.update({ challengePattern: '(' })).rejects.toThrow()
  })
})
