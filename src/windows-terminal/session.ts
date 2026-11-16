import { suggest } from '../shared/shell/completion'
import { HistoryNav, type LineEdit } from '../shared/shell/historyNav'
import type { CommandHistory } from './history'

export class SessionKeys {
  packages: string[] = []
  private readonly navigation: HistoryNav
  private visible = false
  private index = 0
  // A short burst of keystrokes often arrives before adb echoes even the first byte.
  private pending: string | null = null

  constructor(private readonly history: CommandHistory, private readonly send: (bytes: string) => void) {
    this.navigation = new HistoryNav(() => history.list())
  }

  echoed(line: string | null): void {
    if (line === null || this.pending === line) this.pending = null
    if (line === null) {
      this.visible = false
      this.navigation.reset()
    }
  }

  private options(line: string | null) {
    return line === null || !this.visible ? [] : suggest(line, { packages: this.packages, history: this.history.list() })
  }

  candidate(line: string | null) {
    const options = this.options(line)
    return options[this.index % options.length]
  }

  private edit(line: string, action: LineEdit) {
    this.pending = [...line].slice(0, Math.max(0, [...line].length - action.deleteCount)).join('') + action.insert
    this.send('\x7f'.repeat(action.deleteCount) + action.insert)
  }

  input(data: string, screenLine: string | null): void {
    const line = screenLine === null ? null : this.pending ?? screenLine
    const items = this.options(line)
    if (line !== null && items.length) {
      if (data === '\x1b[A' || data === '\x1b[B') {
        this.index = (this.index + (data === '\x1b[A' ? -1 : 1) + items.length) % items.length
        return
      }
      if (data === '\x1b') {
        this.visible = false
        return
      }
      if (data === '\t' || data === '\x1b[C') {
        this.edit(line, items[this.index % items.length])
        this.index = 0
        return
      }
    }
    this.visible = false
    this.index = 0
    if (line !== null && (data === '\x1b[A' || data === '\x1b[B')) {
      const edit = data === '\x1b[A' ? this.navigation.up(line) : this.navigation.down()
      if (edit) { this.edit(line, edit); return }
    }
    if (line !== null && (data === '\r' || data === '\n')) this.history.record(this.navigation.active ? this.navigation.text : line)
    this.navigation.reset()
    this.pending = null
    if (line !== null && !/[\x00-\x1f\x7f]/.test(data)) {
      this.pending = line + data
      this.visible = true
    } else if (line !== null && (data === '\x7f' || data === '\b')) {
      this.pending = [...line].slice(0, -1).join('')
      this.visible = true
    }
    this.send(data)
  }
}
