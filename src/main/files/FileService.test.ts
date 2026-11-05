import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TransferProgress } from '@shared/files'
import type { AdbClient } from '../adb/AdbClient'
import { explainBlockedTarget, FileService } from './FileService'
import { MOUNTS_SEP, type TargetProbe } from './remotePath'

vi.mock('../adb/sync', () => ({ syncPush: vi.fn(async () => undefined) }))
const { syncPush } = await import('../adb/sync')

const MOUNTS = '/dev/root / ext4 ro,seclabel 0 0\n/dev/block/dm-40 /data f2fs rw 0 0'

/** 只模拟用到的 shell 命令：目标检查、id -u、su 探测 */
function fakeAdb(opts: { writable: boolean; uid: number; su: boolean }) {
  const calls: string[] = []
  const shell = vi.fn(async (_serial: string, command: string) => {
    calls.push(command)
    if (command.includes(MOUNTS_SEP)) return `E=1\n${opts.writable ? 'W=1\n' : ''}U=${opts.uid}\nR=/system/app\nM=\n${MOUNTS_SEP}\n${MOUNTS}\n`
    if (command === 'id -u') return `${opts.uid}\n`
    if (command === 'su -c id') {
      if (opts.su) return 'uid=0(root) gid=0(root)\n'
      throw new Error('su: not found')
    }
    if (command === 'su 0 id') throw new Error('su: not found')
    return ''
  })
  return { adb: { shell, exec: vi.fn(async () => ''), serverPort: 5037 } as unknown as AdbClient, calls }
}

let file: string
beforeAll(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'cockpit-')), 'a.bin')
  await writeFile(file, Buffer.alloc(1024))
})

describe('FileService.push preflight', () => {
  it.each([
    { uid: 0, su: false, expected: /adb remount/ },
    { uid: 2000, su: true, expected: /su 可用.*mount -o rw,remount \// },
    { uid: 2000, su: false, expected: /拿不到 root/ }
  ])('explains a read-only partition before sending (uid=$uid su=$su)', async ({ uid, su, expected }) => {
    vi.mocked(syncPush).mockClear()
    const { adb } = fakeAdb({ writable: false, uid, su })
    const phases: string[] = []
    const results = await new FileService(adb).push('X', [file], '/system/app', (p: TransferProgress) => phases.push(p.phase))
    expect(results[0].ok).toBe(false)
    expect(results[0].message).toMatch(/只读挂载/)
    expect(results[0].message).toMatch(expected)
    expect(syncPush).not.toHaveBeenCalled()
    expect(phases).toEqual(['check', 'root'])
  })

  it('offers remount when root is available through the session', async () => {
    vi.mocked(syncPush).mockClear()
    const { adb } = fakeAdb({ writable: false, uid: 2000, su: false })
    const channel = { exec: vi.fn(async () => '') }
    const service = new FileService(adb, () => channel)
    const [result] = await service.push('X', [file], '/system/app')
    expect(result).toMatchObject({ ok: false, remount: '/' })
    expect(result.message).toMatch(/已经进入 root.*remount 后重试/)
    expect(syncPush).not.toHaveBeenCalled()

    await expect(service.remount('X', '/')).resolves.toMatch(/已重新挂载为可写/)
    expect(channel.exec).toHaveBeenCalledWith(expect.stringContaining("mount -o rw,remount '/'"), 30_000)
  })

  it('uploads directly to a writable directory and reports phases', async () => {
    vi.mocked(syncPush).mockClear()
    const { adb } = fakeAdb({ writable: true, uid: 2000, su: false })
    const phases: string[] = []
    const results = await new FileService(adb).push('X', [file], '/sdcard/Download', (p) => phases.push(p.phase))
    expect(results[0]).toMatchObject({ ok: true, target: '/sdcard/Download/a.bin' })
    expect(syncPush).toHaveBeenCalledOnce()
    expect(phases[0]).toBe('check')
    expect(phases).not.toContain('root')
  })
})

describe('explainBlockedTarget', () => {
  const probe = (patch: Partial<TargetProbe>): TargetProbe => ({
    exists: true,
    writable: false,
    uid: 2000,
    realPath: '/data/app',
    mkdirError: '',
    mount: { device: 'dm-40', point: '/data', type: 'f2fs', readOnly: false },
    ...patch
  })

  it('asks for root when the partition is writable but permission is missing', () => {
    expect(explainBlockedTarget('/data/app', probe({}), 'none')).toMatch(/没有写入 \/data\/app 的权限.*拿不到 root/)
  })

  it('lets root handle it when su is available', () => {
    expect(explainBlockedTarget('/data/app', probe({}), 'dash-c')).toBeNull()
  })

  it('detects read-only from the mkdir error when mounts are unavailable', () => {
    const msg = explainBlockedTarget('/system/x', probe({ exists: false, mount: undefined, mkdirError: "mkdir: '/system/x': Read-only file system" }), 'adbd')
    expect(msg).toMatch(/只读挂载.*adb remount/)
  })
})
