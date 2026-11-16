import type { Terminal } from '@xterm/xterm'

/**
 * 从一行屏幕文字里取出提示符后面用户正在输入的命令。
 * Android 提示符形如 `walleye:/ $ `、`root@device:/data # `，也可能只有 `$ `。
 * 找不到提示符（程序在前台运行、登录提示等）时返回 null。
 */
export function extractCommand(text: string): string | null {
  const match = text.match(/^(?:\S*:\S*\s+)?[#$] (.*)$/)
  return match ? match[1] : null
}

/**
 * 读出光标所在的输入行（含自动折行的上几行）。
 * 光标不在行尾（用户在中间编辑）或处于全屏程序（vi、top）时返回 null，不做提示。
 */
export function readInputLine(term: Terminal): string | null {
  const buffer = term.buffer.active
  if (buffer.type !== 'normal') return null
  const row = buffer.baseY + buffer.cursorY
  const current = buffer.getLine(row)
  if (!current) return null
  if (current.translateToString(true, buffer.cursorX).trim()) return null

  let text = current.translateToString(false, 0, buffer.cursorX)
  for (let y = row; y > 0 && buffer.getLine(y)?.isWrapped; y--) {
    text = (buffer.getLine(y - 1)?.translateToString(false) ?? '') + text
  }
  return extractCommand(text)
}
