import type { ThemeMode } from '@shared/theme'
import { useThemeStore } from './themeStore'
import { t } from '../i18n'

const OPTIONS: Array<{ mode: ThemeMode; label: () => string; title: () => string }> = [
  { mode: 'light', label: () => t('白天'), title: () => t('浅色界面') },
  { mode: 'dark', label: () => t('黑夜'), title: () => t('深色界面') },
  { mode: 'system', label: () => t('自适应'), title: () => t('跟随系统的深浅色设置') }
]

export function ThemeSwitch() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  return (
    <div className="segmented theme-switch" data-tour="theme" role="radiogroup" aria-label={t('界面主题')}>
      {OPTIONS.map((o) => (
        <button key={o.mode} role="radio" aria-checked={mode === o.mode} className={mode === o.mode ? 'on' : ''} title={o.title()} onClick={() => setMode(o.mode)}>
          {o.label()}
        </button>
      ))}
    </div>
  )
}
