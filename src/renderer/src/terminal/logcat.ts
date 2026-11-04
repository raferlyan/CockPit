/** logcat 级别，从低到高 */
export const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'] as const
export type Level = (typeof LEVELS)[number]

export interface LogcatFilter {
  /** 只显示不低于该级别的日志 */
  minLevel: Level
  /** 空格或逗号分隔，任一匹配即可；前缀 - 表示排除，如 `ActivityManager -chatty` */
  tags: string
  /** 关键字；写成 /.../ 时按正则匹配 */
  text: string
  /** 只看这个应用：包名或进程号 */
  pkg: string
  /** pkg 解析出的进程号；null 表示没设置或还没解析出来 */
  pids: number[] | null
  ignoreCase: boolean
}

export const DEFAULT_FILTER: LogcatFilter = { minLevel: 'V', tags: '', text: '', pkg: '', pids: null, ignoreCase: true }

export interface LogLine {
  /** 原始内容，带颜色转义 */
  raw: string
  /** 去掉转义后的纯文本，用于匹配和导出 */
  plain: string
  level: Level | null
  tag: string
  pid: number | null
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/** threadtime 格式：`11-04 10:20:30.123  1234  1250 I ActivityManager: msg` */
const THREADTIME = /^\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+\s+(?:\S+\s+)?(\d+)\s+\d+\s+([VDIWEFA])\s+(.*?)\s*:\s/

export function parseLine(raw: string): LogLine {
  const plain = raw.replace(ANSI, '')
  const match = plain.match(THREADTIME)
  if (!match) return { raw, plain, level: null, tag: '', pid: null }
  const level = (match[2] === 'A' ? 'F' : match[2]) as Level
  return { raw, plain, level, tag: match[3], pid: Number(match[1]) }
}

/** 最多缓存这么多行，约几十 MB；更早的丢掉 */
const MAX_LINES = 100_000

/** 一个 logcat 标签的行缓冲：按行切分 pty 输出，筛选变化时可以整体重放 */
export class LogcatBuffer {
  lines: LogLine[] = []
  private rest = ''

  /** 追加输出，返回新的完整行 */
  push(data: string): LogLine[] {
    const parts = (this.rest + data).split(/\r?\n/)
    this.rest = parts.pop() ?? ''
    const added = parts.filter((p) => p.length > 0).map(parseLine)
    this.lines.push(...added)
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
    return added
  }

  clear(): void {
    this.lines = []
  }
}

const buffers = new Map<string, LogcatBuffer>()

export function logcatBuffer(id: string): LogcatBuffer {
  let buffer = buffers.get(id)
  if (!buffer) {
    buffer = new LogcatBuffer()
    buffers.set(id, buffer)
  }
  return buffer
}

export function dropLogcatBuffer(id: string): void {
  buffers.delete(id)
}

export interface CompiledFilter {
  match(line: LogLine): boolean
  /** 关键字高亮用，没有关键字时为空 */
  highlight?: RegExp
  /** 正则写错时的提示 */
  error?: string
  active: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function compileFilter(filter: LogcatFilter): CompiledFilter {
  const minIndex = LEVELS.indexOf(filter.minLevel)
  const words = filter.tags.split(/[\s,]+/).filter(Boolean)
  const include = words.filter((w) => !w.startsWith('-')).map((w) => w.toLowerCase())
  const exclude = words
    .filter((w) => w.startsWith('-'))
    .map((w) => w.slice(1).toLowerCase())
    .filter(Boolean)
  const pids = filter.pkg.trim() ? new Set(filter.pids ?? []) : null

  let highlight: RegExp | undefined
  let error: string | undefined
  const text = filter.text.trim()
  if (text) {
    const flags = filter.ignoreCase ? 'gi' : 'g'
    const regex = text.length > 2 && text.startsWith('/') && text.endsWith('/')
    try {
      highlight = new RegExp(regex ? text.slice(1, -1) : escapeRegExp(text), flags)
    } catch (e) {
      error = (e as Error).message
    }
  }

  const active = minIndex > 0 || include.length > 0 || exclude.length > 0 || Boolean(highlight) || pids !== null
  const tester = highlight ? new RegExp(highlight.source, highlight.flags.replace('g', '')) : undefined

  return {
    active,
    highlight,
    error,
    match: (line) => {
      if (minIndex > 0 && (line.level === null || LEVELS.indexOf(line.level) < minIndex)) return false
      if (include.length || exclude.length) {
        const tag = line.tag.toLowerCase()
        if (include.length && !include.some((w) => tag.includes(w))) return false
        if (exclude.some((w) => tag.includes(w))) return false
      }
      // 应用的进程号还没解析出来（没在运行）时什么都不显示
      if (pids && (line.pid === null || !pids.has(line.pid))) return false
      if (tester && !tester.test(line.plain)) return false
      return true
    }
  }
}

/** 写进 xterm 的一行：有关键字时保留行首颜色，用反色标出匹配处 */
export function renderLine(line: LogLine, highlight?: RegExp): string {
  if (!highlight) return line.raw
  const color = line.raw.match(/^(?:\x1b\[[0-9;]*m)*/)?.[0] ?? ''
  highlight.lastIndex = 0
  const marked = line.plain.replace(highlight, (m) => (m ? `\x1b[7m${m}\x1b[27m` : m))
  return `${color}${marked}\x1b[0m`
}
