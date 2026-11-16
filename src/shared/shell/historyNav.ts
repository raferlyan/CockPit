export interface LineEdit {
  /** 先删掉多少个字符 */
  deleteCount: number
  insert: string
}

/**
 * 上下键翻历史。历史由 Cockpit 自己保存：设备 shell 的历史只在当前会话内有效（新开标签就空了），
 * 串口和部分 su 之后的 shell 甚至不支持行编辑，上下键只会打出 ^[[A。
 * 这里用「退格 + 重新输入」替换当前行，任何 shell 都能用。
 *
 * 翻动期间不读屏幕：连按时回显还没回来，屏幕上的内容是旧的，所以记住上一次送出去的文字。
 */
export class HistoryNav {
  /** -1 表示没在翻；否则是 snapshot 里的下标，0 最新 */
  private index = -1
  private draft = ''
  private shown = ''
  private snapshot: string[] = []

  constructor(private readonly getHistory: () => string[]) {}

  get active(): boolean {
    return this.index >= 0
  }

  /** 正在显示的那条历史，回车时直接用它，不必等回显 */
  get text(): string {
    return this.shown
  }

  /** line 是开始翻之前屏幕上的输入；已经到最旧一条时返回空操作 */
  up(line: string): LineEdit | null {
    if (!this.active) {
      this.snapshot = [...this.getHistory()]
      if (!this.snapshot.length) return null
      this.draft = line
      this.shown = line
    }
    if (this.index + 1 >= this.snapshot.length) return { deleteCount: 0, insert: '' }
    this.index++
    return this.show(this.snapshot[this.index])
  }

  /** 翻回最新之后再按一次，恢复开始翻之前输入的内容 */
  down(): LineEdit | null {
    if (!this.active) return null
    this.index--
    return this.show(this.index >= 0 ? this.snapshot[this.index] : this.draft)
  }

  /** 用户输入了别的内容，或命令已经发出 */
  reset(): void {
    this.index = -1
    this.draft = ''
    this.shown = ''
    this.snapshot = []
  }

  private show(text: string): LineEdit {
    const edit = { deleteCount: [...this.shown].length, insert: text }
    this.shown = text
    return edit
  }
}
