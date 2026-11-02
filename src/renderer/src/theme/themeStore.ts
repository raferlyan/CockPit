import { create } from 'zustand'
import type { ThemeMode } from '@shared/theme'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'

export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  /** 实际生效的深浅色；主进程设置 nativeTheme 后由 prefers-color-scheme 反映出来 */
  resolved: ResolvedTheme
  setMode(mode: ThemeMode): void
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const resolve = (): ResolvedTheme => (darkQuery.matches ? 'dark' : 'light')

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  resolved: resolve(),
  setMode: (mode) => {
    set({ mode })
    api.theme.set(mode).catch((error) => notify('error', '切换主题失败', errorMessage(error)))
  }
}))

/** 应用启动时调用一次，返回取消函数 */
export function connectTheme(): () => void {
  void api.theme.get().then((mode) => useThemeStore.setState({ mode }))
  const onChange = () => useThemeStore.setState({ resolved: resolve() })
  darkQuery.addEventListener('change', onChange)
  return () => darkQuery.removeEventListener('change', onChange)
}

/** 读取 styles.css 里的颜色变量，给 xterm、uPlot 这类不认 CSS 变量的组件用 */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
