import { useState, type FormEvent } from 'react'
import type { Device } from '@shared/models'
import { api } from '../api'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { useAppStore } from '../store'
import { deviceTitle, STATE_LABEL } from '../labels'
import { RootBadge } from './RootBadge'
import { CollapseButton } from '../settings/ToolStripe'
import { DeviceContextMenu } from '../root/DeviceContextMenu'
import { t } from '../i18n'

export function DeviceList() {
  const devices = useAppStore((s) => s.devices)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const focus = useAppStore((s) => s.focus)
  const [menu, setMenu] = useState<{ serial: string; x: number; y: number } | null>(null)
  const menuDevice = menu && devices.find((d) => d.serial === menu.serial)

  return (
    <aside className="sidebar" data-tour="device-list">
      <header className="sidebar-header">
        <span>{t('设备')}</span>
        <span className="sidebar-header-end">
          <span className="count">{devices.length}</span>
          <CollapseButton pane="sidebar" />
        </span>
      </header>

      <ul className="device-list">
        {devices.map((device) => (
          <DeviceItem
            key={device.serial}
            device={device}
            active={device.serial === focusedSerial}
            onSelect={() => focus(device.serial)}
            onMenu={(x, y) => {
              focus(device.serial)
              setMenu({ serial: device.serial, x, y })
            }}
          />
        ))}
        {devices.length === 0 && <li className="empty">{t('未检测到设备，请连接 USB 并开启调试')}</li>}
      </ul>

      <ConnectForm />
      {menu && menuDevice && <DeviceContextMenu device={menuDevice} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </aside>
  )
}

function DeviceItem({ device, active, onSelect, onMenu }: { device: Device; active: boolean; onSelect(): void; onMenu(x: number, y: number): void }) {
  const ready = device.state === 'device'
  return (
    <li>
      <button
        className={`device-item${active ? ' active' : ''}${ready ? '' : ' dim'}`}
        onClick={onSelect}
        title={t('右键：进入 root、打开 root 终端、设置 root 方式')}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(e.clientX, e.clientY)
        }}
      >
        <div className="device-item-top">
          <span className={`dot state-${ready ? 'ok' : 'warn'}`} />
          <span className="device-name">{deviceTitle(device)}</span>
          {ready && <RootBadge state={device.root} shellRoot={device.shellRoot} session={device.rootSession} compact />}
        </div>
        <div className="device-item-sub">
          <span className="mono">{device.serial}</span>
          <span>
            {device.connection === 'tcp' ? 'Wi-Fi' : 'USB'}
            {ready ? '' : ` · ${STATE_LABEL()[device.state]}`}
          </span>
        </div>
      </button>
    </li>
  )
}

function ConnectForm() {
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!address.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      setMessage(await api.adb.connect(address.trim()))
    } catch (error) {
      setMessage(errorMessage(error))
      notify('error', t('无线连接失败'), errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="connect-form" data-tour="connect" onSubmit={submit}>
      <label htmlFor="connect-address">{t('无线连接')}</label>
      <div className="connect-row">
        <input
          id="connect-address"
          placeholder="192.168.1.10:5555"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
        />
        <ActionButton type="submit" disabledReason={busy ? t('正在连接，请稍候') : !address.trim() && t('先输入设备地址，如 192.168.1.10:5555')}>
          {busy ? t('连接中') : t('连接')}
        </ActionButton>
      </div>
      {message && <p className="connect-message">{message}</p>}
    </form>
  )
}
