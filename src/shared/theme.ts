/** 界面主题：白天、黑夜，或跟随系统自适应 */
export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']

/** 窗口底色，与 styles.css 里两套 --bg 一致，避免启动和切换时闪一下 */
export const WINDOW_BACKGROUND = { light: '#f5f6f8', dark: '#14161a' } as const
