import { useEffect, useState } from 'react'
import { ROOT_METHODS, type RootMethod, type RootSettings } from '@shared/root'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { errorMessage, notify } from '../notify/notifyStore'
import { useUiStore } from '../settings/uiStore'
import { enterRoot, METHOD_DESC, METHOD_LABEL } from './rootActions'
import { t } from '../i18n'

const FOLLOW = '__default__'

/**
 * root 方式设置：默认方式、当前设备单独指定的方式，以及密码、解密工具各自的参数。
 * 从设备右键菜单打开时 serial 为该设备，从设置里打开时为空。
 */
export function RootSettingsDialog({ serial }: { serial: string | null }) {
  const close = () => useUiStore.getState().closeRootSettings()
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const [settings, setSettings] = useState<RootSettings | null>(null)
  /** 新输入的密码；undefined 表示不改 */
  const [password, setPassword] = useState<string | undefined>(undefined)
  const [challenge, setChallenge] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.root.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!settings) return null
  const patch = (next: Partial<RootSettings>) => setSettings({ ...settings, ...next })
  const deviceMethod = serial ? settings.deviceMethods[serial] : undefined
  /** 当前设备实际会用的方式，决定下面展开哪一组参数 */
  const effective: RootMethod = deviceMethod ?? settings.defaultMethod
  const shown = new Set<RootMethod>([settings.defaultMethod, effective])

  const save = async (thenEnter: boolean) => {
    setSaving(true)
    try {
      const { hasPassword: _ignored, ...rest } = settings
      const saved = await api.root.setSettings({ ...rest, password })
      setSettings(saved)
      setPassword(undefined)
      close()
      if (thenEnter && serial) void enterRoot(serial, device ? deviceTitle(device) : serial)
      else notify('success', t('root 方式已保存'))
    } catch (error) {
      notify('error', t('保存失败'), errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const testTool = async () => {
    setTestResult(null)
    try {
      const out = await api.root.testTool(settings, challenge.trim())
      setTestResult({ ok: true, text: out })
    } catch (error) {
      setTestResult({ ok: false, text: errorMessage(error) })
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog root-dialog" role="dialog" aria-label={t('root 方式设置')}>
        <div className="panel-title-row">
          <h2 className="panel-title">{t('root 方式设置')}</h2>
          <button className="tool" title={t('关闭')} onClick={close}>
            ×
          </button>
        </div>

        <div className="field">
          <span>{t('默认方式（右键「进入 root」时使用）')}</span>
          <div className="root-methods">
            {ROOT_METHODS.map((m) => (
              <label key={m} className={`root-method${settings.defaultMethod === m ? ' on' : ''}`}>
                <input type="radio" name="root-default" checked={settings.defaultMethod === m} onChange={() => patch({ defaultMethod: m })} />
                <span>
                  <b>{METHOD_LABEL()[m]}</b>
                  <small className="muted">{METHOD_DESC()[m]}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        {serial && (
          <label className="field">
            <span>{t('{name} 使用的方式', { name: device ? deviceTitle(device) : serial })}</span>
            <select
              value={deviceMethod ?? FOLLOW}
              onChange={(e) => {
                const deviceMethods = { ...settings.deviceMethods }
                if (e.target.value === FOLLOW) delete deviceMethods[serial]
                else deviceMethods[serial] = e.target.value as RootMethod
                patch({ deviceMethods })
              }}
            >
              <option value={FOLLOW}>{t('跟随默认（{method}）', { method: METHOD_LABEL()[settings.defaultMethod] })}</option>
              {ROOT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL()[m]}
                </option>
              ))}
            </select>
          </label>
        )}

        {effective !== 'adb-root' && (
          <label className="field">
            <span>{t('su 命令')}</span>
            <input className="mono" value={settings.suCommand} placeholder="su" onChange={(e) => patch({ suCommand: e.target.value })} spellCheck={false} />
          </label>
        )}

        {shown.has('password') && (
          <fieldset className="root-section">
            <legend>{METHOD_LABEL().password}</legend>
            <div className="field-grid two">
              <label className="field">
                <span>{t('用户名（留空表示 root）')}</span>
                <input className="mono" value={settings.passwordUser} placeholder="root" onChange={(e) => patch({ passwordUser: e.target.value })} spellCheck={false} />
              </label>
              <label className="field">
                <span>{t('密码')}</span>
                <input
                  type="password"
                  value={password ?? ''}
                  placeholder={settings.hasPassword ? t('已保存，留空不修改') : t('未保存')}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="muted root-hint">
              {t('密码用系统钥匙串加密后保存在本机，不会显示出来。')}
              {settings.hasPassword && (
                <button className="link" onClick={() => setPassword('')}>
                  {t('清除已保存的密码')}
                </button>
              )}
              {password === '' && settings.hasPassword && <b> {t('保存后清除')}</b>}
            </p>
          </fieldset>
        )}

        {shown.has('challenge') && (
          <fieldset className="root-section">
            <legend>{METHOD_LABEL().challenge}</legend>
            <p className="muted root-hint">
              {t('流程：执行 su → 设备输出挑战码并提示输入密码 → 把挑战码交给解密工具 → 取工具输出的最后一行作为密码填入。')}
            </p>
            <label className="field">
              <span>{t('解密工具')}</span>
              <div className="field-row">
                <input
                  className="mono"
                  value={settings.toolPath}
                  placeholder={api.platform === 'win32' ? 'C:\\tools\\decrypt.exe' : '/path/to/decrypt'}
                  onChange={(e) => patch({ toolPath: e.target.value })}
                  spellCheck={false}
                />
                <button className="secondary" onClick={() => void api.root.pickTool().then((p) => p && patch({ toolPath: p }))}>
                  {t('浏览…')}
                </button>
              </div>
            </label>
            <div className="field-grid two">
              <label className="field">
                <span>{t('参数（{challenge} 会换成挑战码）')}</span>
                <input className="mono" value={settings.toolArgs} placeholder="{challenge}" onChange={(e) => patch({ toolArgs: e.target.value })} spellCheck={false} />
              </label>
              <label className="field">
                <span>{t('提取挑战码的正则（可选，留空自动识别）')}</span>
                <input
                  className="mono"
                  value={settings.challengePattern}
                  placeholder="Challenge:\s*(\w+)"
                  onChange={(e) => patch({ challengePattern: e.target.value })}
                  spellCheck={false}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={settings.toolStdin} onChange={(e) => patch({ toolStdin: e.target.checked })} />
              {t('同时把挑战码写到工具的标准输入')}
            </label>
            <div className="field root-test">
              <span>{t('测试解密工具')}</span>
              <div className="field-row">
                <input className="mono" value={challenge} placeholder={t('粘贴一个 su 给出的挑战码')} onChange={(e) => setChallenge(e.target.value)} spellCheck={false} />
                <button className="secondary" disabled={!settings.toolPath.trim() || !challenge.trim()} onClick={() => void testTool()}>
                  {t('运行')}
                </button>
              </div>
              {testResult && (
                <p className={testResult.ok ? 'root-test-ok mono' : 'error'}>
                  {testResult.ok ? t('工具输出的密码：{pwd}', { pwd: testResult.text }) : testResult.text}
                </p>
              )}
            </div>
          </fieldset>
        )}

        <div className="dialog-actions">
          <span className="spacer" />
          <button className="secondary" onClick={close}>
            {t('取消')}
          </button>
          <button className={serial ? 'secondary' : 'primary'} disabled={saving} onClick={() => void save(false)}>
            {t('保存')}
          </button>
          {serial && device?.state === 'device' && (
            <button className="primary" disabled={saving} onClick={() => void save(true)}>
              {t('保存并进入 root')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
