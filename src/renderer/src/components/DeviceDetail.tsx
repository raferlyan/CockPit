import { useState } from 'react'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle, STATE_LABEL, stateHint } from '../labels'
import { RootBadge } from './RootBadge'
import { ActionButton } from '../notify/ActionButton'
import { droppedPaths, handleDeviceDrop, hasDraggedFiles, useFileStore } from '../files/fileStore'
import { useUiStore } from '../settings/uiStore'
import { takeScreenshot } from '../apps/screenshot'
import { isRecordingActive, useTraceStore } from '../trace/traceStore'
import { CollapseButton } from '../settings/ToolStripe'

export function DeviceDetail() {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === s.focusedSerial))
  const mirrored = useAppStore((s) => (device ? s.mirrorTiles.includes(device.serial) : false))
  const [dropping, setDropping] = useState(false)
  const recording = useTraceStore((s) => (device ? s.recordings[device.serial] : undefined))
  const tracing = isRecordingActive(recording)

  if (!device) {
    return (
      <section className="panel" data-tour="device-detail">
        <div className="panel-title-row">
          <h2 className="panel-title">设备信息</h2>
          <CollapseButton pane="side" />
        </div>
        <p className="empty">未选择设备</p>
      </section>
    )
  }

  const hint = stateHint(device.state)
  const offlineReason = device.state !== 'device' && '设备不在线'
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

  const online = device.state === 'device'
  return (
    <section
      className={`panel device-detail${dropping ? ' dropping' : ''}`}
      data-tour="device-detail"
      onDragOver={(e) => {
        if (!online || !hasDraggedFiles(e)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const paths = droppedPaths(e)
        if (!online || !paths.length) return
        e.preventDefault()
        handleDeviceDrop(device.serial, paths)
      }}
    >
      {dropping && <div className="panel-drop-hint">松开鼠标：APK 直接安装，其它文件上传</div>}
      <div className="panel-title-row">
        <h2 className="panel-title">{deviceTitle(device)}</h2>
        <span className="panel-title-end">
          {device.state === 'device' && <RootBadge state={device.root} />}
          <CollapseButton pane="side" />
        </span>
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
      <div className="detail-actions">
        <ActionButton
          data-tour="btn-mirror"
          className={mirrored ? 'secondary' : 'primary'}
          disabledReason={offlineReason}
          onClick={() => (mirrored ? useAppStore.getState().removeTile(device.serial) : useAppStore.getState().addTile(device.serial))}
        >
          {mirrored ? '停止投屏' : '投屏'}
        </ActionButton>
        <ActionButton
          data-tour="btn-transfer" className="secondary" disabledReason={offlineReason} onClick={() => useFileStore.getState().openTransfer(device.serial)}>
          文件传输
        </ActionButton>
        <ActionButton
          data-tour="btn-apps" className="secondary" disabledReason={offlineReason} onClick={() => useUiStore.getState().openApps(device.serial)}>
          应用管理
        </ActionButton>
        <ActionButton
          data-tour="btn-screenshot" className="secondary" disabledReason={offlineReason} onClick={() => void takeScreenshot(device)}>
          截图
        </ActionButton>
        <ActionButton
          data-tour="btn-trace"
          className={tracing ? 'primary' : 'secondary'}
          disabledReason={!tracing && offlineReason}
          title="用设备自带的 perfetto 录制系统 trace，录完在内嵌的 Perfetto 中打开"
          onClick={() => useTraceStore.getState().openDialog(device.serial)}
        >
          {tracing ? '录制中…' : '录制 Trace'}
        </ActionButton>
        {device.connection === 'tcp' && (
          <button className="secondary" onClick={() => void api.adb.disconnect(device.serial)}>
            断开无线连接
          </button>
        )}
      </div>
    </section>
  )
}
