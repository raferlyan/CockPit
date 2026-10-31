import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle, STATE_LABEL, stateHint } from '../labels'
import { RootBadge } from './RootBadge'

export function DeviceDetail() {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === s.focusedSerial))

  if (!device) {
    return (
      <section className="panel">
        <h2 className="panel-title">设备信息</h2>
        <p className="empty">未选择设备</p>
      </section>
    )
  }

  const hint = stateHint(device.state)
  const info = device.info
  const rows: Array<[string, string | undefined]> = [
    ['序列号', device.serial],
    ['状态', STATE_LABEL[device.state]],
    ['连接', device.connection === 'tcp' ? 'Wi-Fi' : `USB${device.usbPath ? ` (${device.usbPath})` : ''}`],
    ['厂商', info?.manufacturer],
    ['型号', info?.model ?? device.model],
    ['Android', info ? `${info.androidVersion} (API ${info.sdk})` : undefined],
    ['ABI', info?.abi],
    ['分辨率', info?.resolution]
  ]

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2 className="panel-title">{deviceTitle(device)}</h2>
        {device.state === 'device' && <RootBadge state={device.root} />}
      </div>
      {hint && <p className="hint">{hint}</p>}
      <dl className="kv">
        {rows.map(([key, value]) => (
          <div key={key} className="kv-row">
            <dt>{key}</dt>
            <dd className={key === '序列号' ? 'mono' : undefined}>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {device.infoError && (
        <p className="error">
          读取设备信息失败：{device.infoError}
          <button className="link" onClick={() => void api.devices.refreshInfo(device.serial)}>
            重试
          </button>
        </p>
      )}
      {device.connection === 'tcp' && (
        <button className="secondary" onClick={() => void api.adb.disconnect(device.serial)}>
          断开无线连接
        </button>
      )}
    </section>
  )
}
