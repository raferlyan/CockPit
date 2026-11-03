import { BrowserWindow, clipboard, dialog, ipcMain, shell as electronShell } from 'electron'
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
import type { FileService } from './files/FileService'
import type { AppService } from './apps/AppService'
import type { AppAction, AppPackage } from '@shared/apps'
import type { ThemeMode } from '@shared/theme'
import { loadTheme, setTheme } from './theme'
import type { PerfettoUiServer } from './trace/PerfettoUiServer'
import type { TraceLibrary } from './trace/TraceLibrary'
import type { TraceRecorder } from './trace/TraceRecorder'
import type { TraceRecordOptions } from '@shared/trace'

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
  files?: FileService
  apps?: AppService
  /** 串口不依赖 adb，总是可用 */
  serial: SerialService
  /** 内嵌 Perfetto UI，不依赖 adb */
  perfetto: PerfettoUiServer
  traces: TraceLibrary
  recorder?: TraceRecorder
  fallbackStatus: AdbStatus
}): void {
  const { adb, deviceManager, mirror, shell, metrics, files, apps, serial, perfetto, traces, recorder } = ctx
  const requireFiles = () => {
    if (!files) throw new Error('未找到 adb')
    return files
  }
  const requireApps = () => {
    if (!apps) throw new Error('未找到 adb')
    return apps
  }

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

  ipcMain.handle(IpcChannel.DevicesPackages, (_e, serial: string) => requireFiles().packages(serial))
  ipcMain.handle(IpcChannel.FilesList, (_e, serial: string, dir: string) => requireFiles().list(serial, dir))
  ipcMain.handle(IpcChannel.FilesPush, (event, serial: string, localPaths: string[], remoteDir: string, transferId?: string) =>
    requireFiles().push(serial, localPaths, remoteDir, (progress) => {
      if (transferId && !event.sender.isDestroyed()) event.sender.send(IpcChannel.FilesProgress, { transferId, ...progress })
    })
  )
  ipcMain.handle(IpcChannel.FilesPickApk, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '选择要安装的 APK',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Android 应用', extensions: ['apk'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IpcChannel.AppsList, (_e, serial: string) => requireApps().list(serial))
  ipcMain.handle(IpcChannel.AppsRun, (_e, serial: string, pkg: string, action: AppAction, kind: AppPackage['kind']) =>
    requireApps().run(serial, pkg, action, kind)
  )
  ipcMain.handle(IpcChannel.AppsExport, (_e, serial: string, pkg: string, apkPath: string, localDir: string) =>
    requireApps().exportApk(serial, pkg, apkPath, localDir)
  )
  ipcMain.handle(IpcChannel.AppsInstall, (_e, serial: string, apkPaths: string[]) => requireApps().install(serial, apkPaths))
  ipcMain.handle(IpcChannel.DeviceScreenshot, (_e, serial: string, label: string) => requireApps().screenshot(serial, label))
  ipcMain.handle(IpcChannel.FilesPull, (_e, serial: string, remotePath: string, localDir: string) =>
    requireFiles().pull(serial, remotePath, localDir)
  )
  ipcMain.handle(IpcChannel.FilesPickLocal, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '选择要上传的文件', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IpcChannel.FilesPickDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '选择保存位置', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.on(IpcChannel.FilesReveal, (_e, path: string) => electronShell.showItemInFolder(path))
  ipcMain.handle(IpcChannel.TraceUiUrl, () => perfetto.uiUrl())
  ipcMain.handle(IpcChannel.TraceOpen, (_e, localPath: string) => perfetto.register(String(localPath)))
  ipcMain.handle(IpcChannel.TracePick, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '打开 trace 文件',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [
        { name: 'Trace', extensions: ['pftrace', 'perfetto-trace', 'trace', 'pb', 'json', 'gz', 'zip', 'ctrace', 'html'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IpcChannel.TraceList, () => traces.list())
  ipcMain.handle(IpcChannel.TraceRemove, (_e, path: string) => traces.remove(String(path)))
  ipcMain.handle(IpcChannel.TraceOpenDir, async () => {
    const error = await electronShell.openPath(await traces.ensureDir())
    if (error) throw new Error(error)
  })
  ipcMain.handle(IpcChannel.TraceRecordStart, (_e, serial: string, options: TraceRecordOptions, label: string) => {
    if (!recorder) throw new Error('未找到 adb')
    return recorder.start(serial, options, String(label))
  })
  ipcMain.handle(IpcChannel.TraceRecordStop, (_e, serial: string) => recorder?.stop(serial))
  ipcMain.handle(IpcChannel.TraceRecordList, () => recorder?.list() ?? [])
  ipcMain.handle(IpcChannel.ThemeGet, () => loadTheme())
  ipcMain.handle(IpcChannel.ThemeSet, (_e, mode: ThemeMode) => setTheme(mode))
  ipcMain.handle(IpcChannel.ClipboardRead, () => clipboard.readText())
  ipcMain.on(IpcChannel.ClipboardWrite, (_e, text: string) => clipboard.writeText(String(text)))

  ipcMain.handle(IpcChannel.MetricsSnapshot, (_e, serial: string) => metrics?.snapshot(serial) ?? { serial, history: [] })

  deviceManager?.on('devices', (devices) => {
    mirror?.onDevicesChanged(devices)
    shell?.onDevicesChanged(devices)
    metrics?.onDevicesChanged(devices)
    recorder?.onDevicesChanged(devices)
    broadcast(IpcChannel.DevicesChanged, devices)
  })
  deviceManager?.on('status', (status) => broadcast(IpcChannel.AdbStatusChanged, status))
}
