import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Device } from '@shared/models'
import { ROOT_METHODS, type RootMethod } from '@shared/root'
import { api } from '../api'
import { deviceTitle } from '../labels'
import { useTerminalStore } from '../terminal/terminalStore'
import { useUiStore } from '../settings/uiStore'
import { enterRoot, exitRoot, METHOD_LABEL } from './rootActions'
import { t } from '../i18n'
import { isOutsideDeviceMenu } from './deviceMenuDismiss'

/**
 * 设备列表的右键菜单：用默认方式进入 root、临时换一种方式、打开 root 终端、退出 root、配置 root 方式。
 * 用 fixed 定位贴着鼠标，超出窗口时往回收。
 */
export function DeviceContextMenu({ device, x, y, onClose }: { device: Device; x: number; y: number; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [method, setMethod] = useState<RootMethod | null>(null)
  const label = deviceTitle(device)
  const online = device.state === 'device'
  const rooted = Boolean(device.rootSession) || device.root === 'adbd'

  useEffect(() => {
    void api.root.getSettings().then((s) => setMethod(s.deviceMethods[device.serial] ?? s.defaultMethod))
  }, [device.serial])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ left: Math.min(x, window.innerWidth - rect.width - 8), top: Math.min(y, window.innerHeight - rect.height - 8) })
  }, [x, y, method])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (isOutsideDeviceMenu(ref.current, e.target as Node | null)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onBlur = () => onClose()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  const run = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <div ref={ref} className="context-menu device-menu" style={pos} onMouseDown={(e) => e.stopPropagation()} role="menu">
      <div className="context-menu-title">{label}</div>
      <button role="menuitem" disabled={!online} onClick={() => run(() => void enterRoot(device.serial, label))}>
        {device.rootSession ? t('重新进入 root') : t('进入 root')}
        <kbd>{method ? METHOD_LABEL()[method] : ''}</kbd>
      </button>
      <div className="context-menu-group">{t('临时换一种方式')}</div>
      {ROOT_METHODS.filter((m) => m !== method).map((m) => (
        <button key={m} role="menuitem" className="indent" disabled={!online} onClick={() => run(() => void enterRoot(device.serial, label, m))}>
          {METHOD_LABEL()[m]}
        </button>
      ))}
      <hr />
      <button role="menuitem" disabled={!online} onClick={() => run(() => void useTerminalStore.getState().openRoot(device.serial))}>
        {t('打开 root 终端')}
      </button>
      <button role="menuitem" disabled={!online || !rooted} onClick={() => run(() => void exitRoot(device.serial, label))}>
        {device.root === 'adbd' && !device.rootSession ? t('退出 root（adb unroot）') : t('退出 root')}
      </button>
      <hr />
      <button role="menuitem" onClick={() => run(() => useUiStore.getState().openRootSettings(device.serial))}>
        {t('root 方式设置…')}
      </button>
    </div>
  )
}
