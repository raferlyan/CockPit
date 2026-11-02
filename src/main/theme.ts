import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { THEME_MODES, WINDOW_BACKGROUND, type ThemeMode } from '@shared/theme'

/**
 * 主题由主进程保存并设置 nativeTheme.themeSource：
 * 页面的 prefers-color-scheme、原生控件、滚动条和窗口底色都跟着一起变，渲染进程只需响应媒体查询。
 */
const file = () => join(app.getPath('userData'), 'theme.json')

export function loadTheme(): ThemeMode {
  try {
    const mode = (JSON.parse(readFileSync(file(), 'utf8')) as { mode?: ThemeMode }).mode
    return mode && THEME_MODES.includes(mode) ? mode : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
  const background = windowBackground()
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background)
}

export function setTheme(mode: ThemeMode): void {
  if (!THEME_MODES.includes(mode)) throw new Error(`未知主题：${mode}`)
  applyTheme(mode)
  try {
    writeFileSync(file(), JSON.stringify({ mode }))
  } catch (error) {
    console.warn('[theme] 保存失败', error)
  }
}

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/** 跟随系统时，系统切换深浅色也要更新窗口底色 */
nativeTheme.on('updated', () => {
  const background = windowBackground()
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background)
})
