/** Android KeyEvent 常量（android.view.KeyEvent） */
export const AndroidKey = {
  HOME: 3,
  BACK: 4,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  MENU: 82,
  APP_SWITCH: 187
} as const

const META_SHIFT_ON = 0x1
const META_SHIFT_LEFT_ON = 0x40
const META_ALT_ON = 0x2
const META_ALT_LEFT_ON = 0x10
const META_CTRL_ON = 0x1000
const META_CTRL_LEFT_ON = 0x2000
const META_META_ON = 0x10000
const META_META_LEFT_ON = 0x20000

/** KeyboardEvent.code → Android keycode */
const CODE_MAP: Record<string, number> = {
  Enter: 66,
  NumpadEnter: 160,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  Space: 62,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Insert: 124,
  Minus: 69,
  Equal: 70,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73,
  Semicolon: 74,
  Quote: 75,
  Slash: 76,
  Comma: 55,
  Period: 56,
  Backquote: 68,
  ShiftLeft: 59,
  ShiftRight: 60,
  ControlLeft: 113,
  ControlRight: 114,
  AltLeft: 57,
  AltRight: 58,
  MetaLeft: 117,
  MetaRight: 118,
  CapsLock: 115
}

for (let i = 0; i < 26; i++) CODE_MAP[`Key${String.fromCharCode(65 + i)}`] = 29 + i
for (let i = 0; i <= 9; i++) CODE_MAP[`Digit${i}`] = 7 + i
for (let i = 1; i <= 12; i++) CODE_MAP[`F${i}`] = 130 + i

/** 这些键总是按键码发送（不经文本输入） */
const NON_TEXT_CODES = new Set([
  'Enter',
  'NumpadEnter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)
])

export function toAndroidKeycode(code: string): number | undefined {
  return CODE_MAP[code]
}

export function metaStateOf(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
  let meta = 0
  if (e.shiftKey) meta |= META_SHIFT_ON | META_SHIFT_LEFT_ON
  if (e.altKey) meta |= META_ALT_ON | META_ALT_LEFT_ON
  if (e.ctrlKey) meta |= META_CTRL_ON | META_CTRL_LEFT_ON
  if (e.metaKey) meta |= META_META_ON | META_META_LEFT_ON
  return meta
}

/**
 * 决定一个按键按键码发送还是交给文本输入：
 * - 功能键（回车、退格、方向键等）→ 按键码
 * - 带 Ctrl/Alt 的组合键（如 Ctrl+A）→ 按键码
 * - 其他可打印字符 → 文本（由隐藏输入框的 input/composition 事件处理，支持输入法）
 */
export function shouldSendAsKeycode(e: { code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  if (!(e.code in CODE_MAP)) return false
  if (NON_TEXT_CODES.has(e.code)) return true
  return e.ctrlKey || e.altKey || e.metaKey
}

/** INJECT_TEXT 只能输入设备键盘布局里有的字符，其他字符改走剪贴板粘贴 */
export function isInjectableText(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text)
}
