import { create } from 'zustand'
import { api } from '../api'

/** 可拖动边框调整的区域尺寸（像素） */
export interface PaneSizes {
  /** 左侧设备列表宽度 */
  sidebar: number
  /** 右侧设备信息 / 状态栏宽度 */
  side: number
  /** 底部终端高度 */
  terminal: number
}

export interface Settings {
  /** 整体界面缩放，1 为原始大小 */
  uiScale: number
  /** 界面字体（CSS font-family），空字符串为系统默认 */
  uiFont: string
  /** 等宽字体，用于终端、路径、数值 */
  monoFont: string
  /** 终端字号（缩放前的像素） */
  terminalFontSize: number
  panes: PaneSizes
}

export const DEFAULT_PANES: PaneSizes = { sidebar: 240, side: 340, terminal: 260 }

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  uiFont: '',
  monoFont: '',
  terminalFontSize: 12,
  panes: DEFAULT_PANES
}

export const SYSTEM_UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif"
export const SYSTEM_MONO_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

/** 各区域的拖动范围；终端和右栏的上限还受窗口大小约束，见 clampPanes */
export const PANE_LIMITS: Record<keyof PaneSizes, [number, number]> = {
  sidebar: [160, 480],
  side: [260, 720],
  terminal: [100, 900]
}

const KEY = 'cockpit.settings'

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...saved, panes: { ...DEFAULT_PANES, ...saved.panes } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 存储不可用时本次会话内仍然生效
  }
}

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void
  setPane(name: keyof PaneSizes, size: number): void
  resetPanes(): void
  reset(): void
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const commit = (patch: Partial<Settings>) => {
    set(patch)
    const { uiScale, uiFont, monoFont, terminalFontSize, panes } = get()
    save({ uiScale, uiFont, monoFont, terminalFontSize, panes })
  }
  return {
    ...load(),
    update: commit,
    setPane: (name, size) => {
      const [min, max] = PANE_LIMITS[name]
      commit({ panes: { ...get().panes, [name]: Math.round(Math.min(Math.max(size, min), max)) } })
    },
    resetPanes: () => commit({ panes: DEFAULT_PANES }),
    reset: () => commit(DEFAULT_SETTINGS)
  }
})

/** 把缩放和字体应用到页面；启动时调用一次，返回取消函数 */
export function connectSettings(): () => void {
  const apply = (s: Settings) => {
    api.app.setZoom(s.uiScale)
    const root = document.documentElement.style
    root.setProperty('--ui-font', s.uiFont ? `${quoteFont(s.uiFont)}, ${SYSTEM_UI_FONT}` : SYSTEM_UI_FONT)
    root.setProperty('--mono', monoFontStack(s.monoFont))
  }
  apply(useSettingsStore.getState())
  return useSettingsStore.subscribe((s, prev) => {
    if (s.uiScale !== prev.uiScale || s.uiFont !== prev.uiFont || s.monoFont !== prev.monoFont) apply(s)
  })
}

/** 等宽字体栈，终端和 --mono 共用；用户的字体装不上时退回系统等宽字体 */
export function monoFontStack(monoFont: string): string {
  return monoFont ? `${quoteFont(monoFont)}, ${SYSTEM_MONO_FONT}` : SYSTEM_MONO_FONT
}

/** 用户输入的字体名可能带空格，加引号；已经是字体栈（含逗号或引号）的原样使用 */
export function quoteFont(name: string): string {
  const trimmed = name.trim()
  return /[,'"]/.test(trimmed) ? trimmed : `"${trimmed}"`
}
