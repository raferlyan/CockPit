import type { ThemeMode } from '@shared/theme'
import { useThemeStore } from './themeStore'

const OPTIONS: Array<{ mode: ThemeMode; label: string; title: string }> = [
  { mode: 'light', label: '白天', title: '浅色界面' },
  { mode: 'dark', label: '黑夜', title: '深色界面' },
  { mode: 'system', label: '自适应', title: '跟随系统的深浅色设置' }
]

export function ThemeSwitch() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  return (
    <div className="segmented theme-switch" data-tour="theme" role="radiogroup" aria-label="界面主题">
      {OPTIONS.map((o) => (
        <button key={o.mode} role="radio" aria-checked={mode === o.mode} className={mode === o.mode ? 'on' : ''} title={o.title} onClick={() => setMode(o.mode)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
