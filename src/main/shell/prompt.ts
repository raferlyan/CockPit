import type { TerminalIdentity } from '@shared/terminal'

// 去掉 ANSI 转义序列（颜色、光标移动、OSC 标题）
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * 根据输出末尾的提示符推断身份。Android 的 mksh 提示符形如
 * `OnePlus7Pro:/ $ `、`OnePlus7Pro:/data # `；su 后的 Magisk shell 也是 `#`。
 * 只认“主机名:路径 [#$] ”或单独的 `# `、`$ ` 这种整行形态，避免把普通输出里的 `$` 误判为提示符。
 */
export function detectIdentity(tail: string): TerminalIdentity | undefined {
  const lines = stripAnsi(tail).split(/\r?\n|\r/)
  const last = lines[lines.length - 1]
  const match = last.match(/^(?:\S*:\S* )?([#$]) ?$/)
  if (!match) return undefined
  return match[1] === '#' ? 'root' : 'user'
}
