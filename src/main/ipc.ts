import { BrowserWindow, ipcMain } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type { AdbStatus } from '@shared/models'
import type { AdbClient } from './adb/AdbClient'
import type { DeviceManager } from './devices/DeviceManager'
import type { MirrorService } from './mirror/MirrorService'
import type { ShellService } from './shell/ShellService'
import type { MetricsService } from './metrics/MetricsService'
import type { TerminalOpenOptions } from '@shared/terminal'
import type { SerialService } from './serial/SerialService'
import type { SerialOptions } from '@shared/serial'
import type { ControlInput, MirrorOptions } from '@shared/mirror'

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * adb 不可用时 adb/deviceManager 为空，渲染进程仍能拿到状态并提示用户。
 */
export function registerIpc(ctx: {
  adb?: AdbClient
  deviceManager?: DeviceManager
  mirror?: MirrorService
  shell?: ShellService
  metrics?: MetricsService
  /** 串口不依赖 adb，总是可用 */
  serial: SerialService
  fallbackStatus: AdbStatus
}): void {
  const { adb, deviceManager, mirror, shell, metrics, serial } = ctx

  ipcMain.handle(IpcChannel.DevicesList, () => deviceManager?.list() ?? [])
  ipcMain.handle(IpcChannel.DevicesRefreshInfo, (_e, serial: string) => deviceManager?.refreshInfo(serial))
  ipcMain.handle(IpcChannel.AdbStatus, () => deviceManager?.getStatus() ?? ctx.fallbackStatus)

  ipcMain.handle(IpcChannel.AdbConnect, async (_e, address: string) => {
    if (!adb) throw new Error('未找到 adb')
    if (!/^[\w.-]+(:\d{1,5})?$/.test(address)) throw new Error('地址格式应为 host:port')
    return adb.connect(address)
  })
  ipcMain.handle(IpcChannel.AdbDisconnect, async (_e, serial: string) => {
    if (!adb) throw new Error('未找到 adb')
    return adb.disconnect(serial)
  })

  ipcMain.handle(IpcChannel.MirrorStart, (event, serial: string, options?: MirrorOptions) => {
    if (!mirror) throw new Error('未找到 adb')
    return mirror.start(event.sender, serial, options)
  })
  ipcMain.handle(IpcChannel.MirrorStop, (_e, sessionId: string) => mirror?.stop(sessionId))
  ipcMain.on(IpcChannel.MirrorControl, (_e, sessionId: string, input: ControlInput) => mirror?.control(sessionId, input))

  ipcMain.handle(IpcChannel.TerminalOpen, (event, serial: string, options: TerminalOpenOptions) => {
    if (!shell) throw new Error('未找到 adb')
    if (!deviceManager?.list().some((d) => d.serial === serial && d.state === 'device')) throw new Error('设备不在线')
    return shell.open(event.sender, serial, options)
  })
  ipcMain.handle(IpcChannel.TerminalOpenSerial, (event, options: SerialOptions) => serial.open(event.sender, options))
  ipcMain.handle(IpcChannel.SerialList, () => serial.list())
  // 终端 id 全局唯一，各服务只处理自己的会话
  ipcMain.on(IpcChannel.TerminalWrite, (_e, id: string, data: string) => {
    shell?.write(id, data)
    serial.write(id, data)
  })
  ipcMain.on(IpcChannel.TerminalResize, (_e, id: string, cols: number, rows: number) => shell?.resize(id, cols, rows))
  ipcMain.handle(IpcChannel.TerminalClose, (_e, id: string) => {
    shell?.close(id)
    serial.close(id)
  })

  ipcMain.handle(IpcChannel.MetricsSnapshot, (_e, serial: string) => metrics?.snapshot(serial) ?? { serial, history: [] })

  deviceManager?.on('devices', (devices) => {
    mirror?.onDevicesChanged(devices)
    shell?.onDevicesChanged(devices)
    metrics?.onDevicesChanged(devices)
    broadcast(IpcChannel.DevicesChanged, devices)
  })
  deviceManager?.on('status', (status) => broadcast(IpcChannel.AdbStatusChanged, status))
}
