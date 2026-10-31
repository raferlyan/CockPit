import { useState, type FormEvent } from 'react'
import type { Device } from '@shared/models'
import { api } from '../api'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { useAppStore } from '../store'
import { deviceTitle, STATE_LABEL } from '../labels'
import { RootBadge } from './RootBadge'

export function DeviceList() {
  const devices = useAppStore((s) => s.devices)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const focus = useAppStore((s) => s.focus)

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span>设备</span>
        <span className="count">{devices.length}</span>
      </header>

      <ul className="device-list">
        {devices.map((device) => (
          <DeviceItem
            key={device.serial}
            device={device}
            active={device.serial === focusedSerial}
            onSelect={() => focus(device.serial)}
          />
        ))}
        {devices.length === 0 && <li className="empty">未检测到设备，请连接 USB 并开启调试</li>}
      </ul>

      <ConnectForm />
    </aside>
  )
}

function DeviceItem({ device, active, onSelect }: { device: Device; active: boolean; onSelect(): void }) {
  const ready = device.state === 'device'
  return (
    <li>
      <button className={`device-item${active ? ' active' : ''}${ready ? '' : ' dim'}`} onClick={onSelect}>
        <div className="device-item-top">
          <span className={`dot state-${ready ? 'ok' : 'warn'}`} />
          <span className="device-name">{deviceTitle(device)}</span>
          {ready && <RootBadge state={device.root} compact />}
        </div>
        <div className="device-item-sub">
          <span className="mono">{device.serial}</span>
          <span>
            {device.connection === 'tcp' ? 'Wi-Fi' : 'USB'}
            {ready ? '' : ` · ${STATE_LABEL[device.state]}`}
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
      notify('error', '无线连接失败', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="connect-form" onSubmit={submit}>
      <label htmlFor="connect-address">无线连接</label>
      <div className="connect-row">
        <input
          id="connect-address"
          placeholder="192.168.1.10:5555"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
        />
        <ActionButton type="submit" disabledReason={busy ? '正在连接，请稍候' : !address.trim() && '先输入设备地址，如 192.168.1.10:5555'}>
          {busy ? '连接中' : '连接'}
        </ActionButton>
      </div>
      {message && <p className="connect-message">{message}</p>}
    </form>
  )
}
