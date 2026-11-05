import { describe, expect, it } from 'vitest'
import type { OpLogEvent } from '@shared/oplog'
import { formatCommand, OperationLog, recordCommand } from './OperationLog'
import { failureOf } from './operations'

const tick = () => new Promise((r) => setTimeout(r, 120))

describe('OperationLog', () => {
  it('collects commands run inside an operation, across awaits', async () => {
    const events: OpLogEvent[] = []
    const log = new OperationLog((e) => events.push(e))
    await log.run({ label: '上传文件', serial: 'X' }, async () => {
      recordCommand('adb -s X shell id')
      await new Promise((r) => setTimeout(r, 5))
      await Promise.all([Promise.resolve().then(() => recordCommand('adb -s X push a b', 'sync'))])
    })
    const [entry] = log.list()
    expect(entry).toMatchObject({ label: '上传文件', serial: 'X', status: 'ok' })
    expect(entry.commands.map((c) => c.text)).toEqual(['adb -s X shell id', 'adb -s X push a b'])
    expect(entry.commands[1].note).toBe('sync')
    await tick()
    expect(events.at(-1)).toMatchObject({ type: 'upsert', entry: { status: 'ok' } })
  })

  it('ignores commands outside any operation (background polling)', async () => {
    const log = new OperationLog(() => undefined)
    recordCommand('adb -s X shell top -n 1')
    await log.run({ label: '截图' }, async () => undefined)
    recordCommand('adb -s X shell cat /proc/meminfo')
    expect(log.list()[0].commands).toEqual([])
  })

  it('records failures and partial failures', async () => {
    const log = new OperationLog(() => undefined)
    await expect(log.run({ label: '进入 root' }, async () => Promise.reject(new Error('su 执行失败')))).rejects.toThrow()
    await log.run({ label: '上传文件' }, async () => log.fail('只读'))
    expect(log.list().map((e) => [e.status, e.error])).toEqual([
      ['error', 'su 执行失败'],
      ['error', '只读']
    ])
  })

  it('quotes arguments so commands can be pasted into a shell', () => {
    expect(formatCommand('adb', ['-s', 'X', 'shell', "ls '/sdcard/My Files'"])).toBe(`adb -s X shell 'ls '\\''/sdcard/My Files'\\'''`)
    expect(formatCommand('adb', ['-s', 'X', 'pull', '/sdcard/a.txt', '/Users/me/Desktop'])).toBe('adb -s X pull /sdcard/a.txt /Users/me/Desktop')
  })

  it('finds failures inside results', () => {
    expect(failureOf([{ ok: true }, { ok: false, message: 'denied' }])).toBe('denied')
    expect(failureOf({ ok: true })).toBeUndefined()
    expect(failureOf('text')).toBeUndefined()
  })
})
