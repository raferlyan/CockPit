import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { OpEntry, OpLogEvent } from '@shared/oplog'

/** 最多保留的操作条数，超出丢弃最早的 */
const MAX_ENTRIES = 300
/** 单条操作最多记录的命令数，避免长时间投屏这类操作无限增长 */
const MAX_COMMANDS = 200
/** 命令成批推送给界面，频繁执行 shell 时不会每条一个 IPC */
const EMIT_DELAY = 80

const context = new AsyncLocalStorage<OpEntry>()
let active: OperationLog | undefined

/** 按 shell 规则给参数加引号，复制出去可以直接粘贴执行 */
export function quoteArg(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

export function formatCommand(program: string, args: string[]): string {
  return [program, ...args.map(quoteArg)].join(' ')
}

/**
 * 记下当前操作里执行的一条命令。不在任何操作里（如每秒的状态采集）时什么都不做，
 * 所以 AdbClient 等底层可以放心地每次都调用。
 */
export function recordCommand(text: string, note?: string): void {
  const entry = context.getStore()
  if (!entry || !active) return
  if (entry.commands.length >= MAX_COMMANDS) return
  entry.commands.push({ at: Date.now(), text, note })
  active.changed(entry)
}

/**
 * 操作日志：IPC 处理用户操作时用 run() 包起来，期间执行的 adb 命令都会归到这条记录下。
 * 借助 AsyncLocalStorage，命令在 await 链里怎么传递都能找到所属的操作。
 */
export class OperationLog {
  private readonly entries: OpEntry[] = []
  private readonly pending = new Set<OpEntry>()
  private timer?: NodeJS.Timeout

  constructor(private readonly emit: (event: OpLogEvent) => void) {
    active = this
  }

  run<T>(info: { label: string; serial?: string; detail?: string }, fn: () => Promise<T> | T): Promise<T> {
    const entry: OpEntry = { id: randomUUID(), at: Date.now(), serial: info.serial ?? '', label: info.label, detail: info.detail, status: 'running', commands: [] }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.changed(entry)
    return context.run(entry, async () => {
      try {
        const result = await fn()
        // fail() 可能已经标成失败（结果里有失败项），不覆盖
        if (entry.status === 'running') entry.status = 'ok'
        return result
      } catch (error) {
        entry.status = 'error'
        entry.error = (error as Error)?.message ?? String(error)
        throw error
      } finally {
        entry.durationMs = Date.now() - entry.at
        this.changed(entry)
      }
    })
  }

  /** 操作已结束但把结果标为失败（如上传返回了失败的文件，但调用本身没有抛错） */
  fail(message: string): void {
    const entry = context.getStore()
    if (!entry) return
    entry.error = message
    entry.status = 'error'
    this.changed(entry)
  }

  list(): OpEntry[] {
    return this.entries.map(clone)
  }

  clear(): void {
    this.entries.length = 0
    this.pending.clear()
    this.emit({ type: 'clear' })
  }

  changed(entry: OpEntry): void {
    this.pending.add(entry)
    this.timer ??= setTimeout(() => this.flush(), EMIT_DELAY)
  }

  private flush(): void {
    this.timer = undefined
    for (const entry of this.pending) if (this.entries.includes(entry)) this.emit({ type: 'upsert', entry: clone(entry) })
    this.pending.clear()
  }
}

function clone(entry: OpEntry): OpEntry {
  return { ...entry, commands: entry.commands.map((c) => ({ ...c })) }
}
