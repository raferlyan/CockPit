import { describe, expect, it } from 'vitest'
import { compileFilter, DEFAULT_FILTER, LogcatBuffer, parseLine, renderLine } from './logcat'

const line = (level: string, tag: string, msg: string, pid = 1234) => `\x1b[38;5;75m11-04 10:20:30.123  ${pid}  1250 ${level} ${tag}: ${msg}\x1b[0m`

describe('logcat', () => {
  it('parses threadtime lines with color codes', () => {
    expect(parseLine(line('W', 'ActivityManager', 'slow'))).toMatchObject({ level: 'W', tag: 'ActivityManager', pid: 1234 })
    expect(parseLine('--------- beginning of main').level).toBeNull()
  })

  it('splits chunks into complete lines', () => {
    const buffer = new LogcatBuffer()
    const second = line('I', 'B', 'two')
    expect(buffer.push(`${line('I', 'A', 'one')}\r\n${second.slice(0, 20)}`)).toHaveLength(1)
    expect(buffer.push(`${second.slice(20)}\r\n`)).toHaveLength(1)
    expect(buffer.lines.map((l) => l.tag)).toEqual(['A', 'B'])
  })

  it('filters by level, tags, keyword and pid', () => {
    const lines = [line('D', 'Foo', 'hello'), line('E', 'Bar', 'Hello world', 99), line('W', 'chatty', 'spam')].map(parseLine)
    const pick = (patch: Partial<typeof DEFAULT_FILTER>) => lines.filter(compileFilter({ ...DEFAULT_FILTER, ...patch }).match).map((l) => l.tag)
    expect(pick({ minLevel: 'W' })).toEqual(['Bar', 'chatty'])
    expect(pick({ tags: '-chatty' })).toEqual(['Foo', 'Bar'])
    expect(pick({ text: 'hello' })).toEqual(['Foo', 'Bar'])
    expect(pick({ text: 'hello', ignoreCase: false })).toEqual(['Foo'])
    expect(pick({ text: '/w.rld$/' })).toEqual(['Bar'])
    expect(pick({ pkg: 'com.x', pids: [99] })).toEqual(['Bar'])
    expect(compileFilter({ ...DEFAULT_FILTER, text: '/(/' }).error).toBeTruthy()
  })

  it('highlights keyword matches while keeping the line color', () => {
    const parsed = parseLine(line('I', 'Foo', 'hello'))
    const out = renderLine(parsed, compileFilter({ ...DEFAULT_FILTER, text: 'hello' }).highlight)
    expect(out.startsWith('\x1b[38;5;75m')).toBe(true)
    expect(out).toContain('\x1b[7mhello\x1b[27m')
  })
})
