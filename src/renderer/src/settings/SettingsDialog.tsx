import { useEffect, useState } from 'react'
import { ThemeSwitch } from '../theme/ThemeSwitch'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'
import { HIDE_ALL_SHORTCUT, paneShortcut } from './ToolStripe'

const UI_FONTS = [
  { value: '', label: '系统默认' },
  { value: 'PingFang SC', label: '苹方 PingFang SC' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'HarmonyOS Sans SC', label: 'HarmonyOS Sans' },
  { value: 'Noto Sans CJK SC', label: '思源黑体 Noto Sans CJK' },
  { value: 'MiSans', label: 'MiSans' }
]

const MONO_FONTS = [
  { value: '', label: '系统默认' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Sarasa Mono SC', label: '更纱黑体 Sarasa Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Menlo', label: 'Menlo' }
]

const CUSTOM = '__custom__'

/** 预设下拉 + 自定义输入；字体没装时浏览器会退回系统字体 */
function FontField({ label, value, presets, onChange }: { label: string; value: string; presets: typeof UI_FONTS; onChange(v: string): void }) {
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
          <option value={CUSTOM}>自定义…</option>
        </select>
        {custom && (
          <input
            autoFocus
            value={draft}
            placeholder="本机已安装的字体名"
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
      <div className="dialog settings-dialog" role="dialog" aria-label="设置">
        <div className="panel-title-row">
          <h2 className="panel-title">设置</h2>
          <button className="tool" title="关闭" onClick={close}>
            ×
          </button>
        </div>

        <h3 className="status-heading">外观</h3>
        <div className="field">
          <span>主题</span>
          <ThemeSwitch />
        </div>
        <label className="field">
          <span>
            整体字号（界面缩放）<b className="settings-value">{percent}%</b>
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
          <small className="muted">快捷键：{window.cockpit.platform === 'darwin' ? '⌘' : 'Ctrl'} + = / − / 0</small>
        </label>
        <FontField label="界面字体" value={settings.uiFont} presets={UI_FONTS} onChange={(uiFont) => settings.update({ uiFont })} />
        <FontField label="等宽字体（终端、路径、数值）" value={settings.monoFont} presets={MONO_FONTS} onChange={(monoFont) => settings.update({ monoFont })} />
        <label className="field">
          <span>
            终端字号<b className="settings-value">{settings.terminalFontSize}px</b>
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

        <h3 className="status-heading">布局</h3>
        <p className="muted settings-tip">
          拖动区域之间的边框可以调整大小，双击边框恢复默认。设备列表、设备信息和终端可以点标题栏的箭头收起成边缘的图标条，快捷键 {paneShortcut('sidebar')} /{' '}
          {paneShortcut('side')} / {paneShortcut('terminal')}，{HIDE_ALL_SHORTCUT} 一键收起或展开全部。
        </p>

        <div className="dialog-actions settings-actions">
          <button
            className="secondary"
            onClick={() => {
              close()
              useUiStore.getState().setGuideOpen(true)
            }}
          >
            查看使用向导
          </button>
          <button className="secondary" onClick={settings.resetPanes}>
            恢复默认布局
          </button>
          <span className="spacer" />
          <button className="secondary" onClick={settings.reset}>
            全部恢复默认
          </button>
          <button className="primary" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
