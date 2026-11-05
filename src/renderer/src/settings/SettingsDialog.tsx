import { useEffect, useState } from 'react'
import { ThemeSwitch } from '../theme/ThemeSwitch'
import { DEFAULT_TERMINAL_FONT, useSettingsStore, type Language } from './settingsStore'
import { t } from '../i18n'
import { useUiStore } from './uiStore'
import { HIDE_ALL_SHORTCUT, paneShortcut } from './ToolStripe'

const UI_FONTS = () => [
  { value: '', label: t('系统默认') },
  { value: 'PingFang SC', label: '苹方 PingFang SC' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'HarmonyOS Sans SC', label: 'HarmonyOS Sans' },
  { value: 'Noto Sans CJK SC', label: '思源黑体 Noto Sans CJK' },
  { value: 'MiSans', label: 'MiSans' }
]

const MONO_FONTS = () => [
  { value: '', label: t('系统默认') },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Sarasa Mono SC', label: '更纱黑体 Sarasa Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Menlo', label: 'Menlo' }
]

const TERMINAL_FONTS = () => [
  { value: DEFAULT_TERMINAL_FONT, label: t('Cascadia Mono（Terminal Preview 默认）') },
  { value: '', label: t('跟随等宽字体') },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Sarasa Mono SC', label: t('更纱黑体 Sarasa Mono') },
  { value: 'SF Mono', label: 'SF Mono' },
  { value: 'Menlo', label: 'Menlo' },
  { value: 'Consolas', label: 'Consolas' }
]

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' }
]

const CUSTOM = '__custom__'

/** 预设下拉 + 自定义输入；字体没装时浏览器会退回系统字体 */
function FontField({ label, value, presets, onChange }: { label: string; value: string; presets: Array<{ value: string; label: string }>; onChange(v: string): void }) {
  const isPreset = presets.some((p) => p.value === value)
  const [custom, setCustom] = useState(!isPreset)
  const [draft, setDraft] = useState(isPreset ? '' : value)

  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-row">
        <select
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustom(true)
              return
            }
            setCustom(false)
            onChange(e.target.value)
          }}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value} style={p.value ? { fontFamily: `"${p.value}"` } : undefined}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>{t('自定义…')}</option>
        </select>
        {custom && (
          <input
            autoFocus
            value={draft}
            placeholder={t('本机已安装的字体名')}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(draft.trim())}
            onKeyDown={(e) => e.key === 'Enter' && onChange(draft.trim())}
          />
        )}
      </div>
    </label>
  )
}

export function SettingsDialog() {
  const settings = useSettingsStore()
  const close = () => useUiStore.getState().setSettingsOpen(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const percent = Math.round(settings.uiScale * 100)

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog settings-dialog" role="dialog" aria-label={t('设置')}>
        <div className="panel-title-row">
          <h2 className="panel-title">{t('设置')}</h2>
          <button className="tool" title={t('关闭')} onClick={close}>
            ×
          </button>
        </div>

        <h3 className="status-heading">{t('外观')}</h3>
        <div className="field">
          <span>{t('语言 / Language')}</span>
          <div className="segmented">
            {LANGUAGES.map((l) => (
              <button key={l.value} className={settings.language === l.value ? 'on' : ''} onClick={() => settings.update({ language: l.value })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{t('主题')}</span>
          <ThemeSwitch />
        </div>
        <label className="field">
          <span>
            {t('整体字号（界面缩放）')}<b className="settings-value">{percent}%</b>
          </span>
          <div className="field-row scale-row">
            <button className="secondary" onClick={() => settings.update({ uiScale: Math.max(0.8, settings.uiScale - 0.05) })}>
              A−
            </button>
            <input
              type="range"
              min={80}
              max={150}
              step={5}
              value={percent}
              onChange={(e) => settings.update({ uiScale: Number(e.target.value) / 100 })}
            />
            <button className="secondary" onClick={() => settings.update({ uiScale: Math.min(1.5, settings.uiScale + 0.05) })}>
              A+
            </button>
          </div>
          <small className="muted">
            {t('快捷键：')}
            {window.cockpit.platform === 'darwin' ? '⌘' : 'Ctrl'} + = / − / 0
          </small>
        </label>
        <FontField label={t('界面字体')} value={settings.uiFont} presets={UI_FONTS()} onChange={(uiFont) => settings.update({ uiFont })} />
        <FontField label={t('等宽字体（路径、数值）')} value={settings.monoFont} presets={MONO_FONTS()} onChange={(monoFont) => settings.update({ monoFont })} />
        <FontField
          label={t('终端字体（Shell、logcat、串口）')}
          value={settings.terminalFont}
          presets={TERMINAL_FONTS()}
          onChange={(terminalFont) => settings.update({ terminalFont })}
        />
        <label className="field">
          <span>
            {t('终端字号')}<b className="settings-value">{settings.terminalFontSize}px</b>
          </span>
          <input
            type="range"
            min={10}
            max={22}
            step={1}
            value={settings.terminalFontSize}
            onChange={(e) => settings.update({ terminalFontSize: Number(e.target.value) })}
          />
        </label>

        <h3 className="status-heading">{t('布局')}</h3>
        <p className="muted settings-tip">
          {t(
            '拖动区域之间的边框可以调整大小，双击边框恢复默认。设备列表、设备信息和终端可以点标题栏的箭头收起成边缘的图标条，快捷键 {a} / {b} / {c}，{all} 一键收起或展开全部。',
            { a: paneShortcut('sidebar'), b: paneShortcut('side'), c: paneShortcut('terminal'), all: HIDE_ALL_SHORTCUT }
          )}
        </p>

        <div className="dialog-actions settings-actions">
          <button
            className="secondary"
            onClick={() => {
              close()
              useUiStore.getState().setGuideOpen(true)
            }}
          >
            {t('查看使用向导')}
          </button>
          <button className="secondary" onClick={settings.resetPanes}>
            {t('恢复默认布局')}
          </button>
          <button
            className="secondary"
            onClick={() => {
              close()
              useUiStore.getState().openRootSettings(null)
            }}
          >
            {t('root 方式…')}
          </button>
          <span className="spacer" />
          <button className="secondary" onClick={settings.reset}>
            {t('全部恢复默认')}
          </button>
          <button className="primary" onClick={close}>
            {t('完成')}
          </button>
        </div>
      </div>
    </div>
  )
}
