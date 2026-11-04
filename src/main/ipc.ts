import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, clipboard, dialog, ipcMain, shell as electronShell, type IpcMainInvokeEvent } from 'electron'
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
import { setLanguage, tm, translateError } from './i18n'

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
  /** 进行中的上传，可取消；设备断开时自动取消 */
  const transfers = new Map<string, { serial: string; controller: AbortController }>()

  // 所有 invoke 的错误信息都跟随界面语言
  const handle = <A extends unknown[]>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: A) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await listener(event, ...(args as A))
      } catch (error) {
        if (error instanceof Error) error.message = translateError(error.message)
        throw error
      }
    })

  handle(IpcChannel.DevicesList, () => deviceManager?.list() ?? [])
  handle(IpcChannel.DevicesRefreshInfo, (_e, serial: string) => deviceManager?.refreshInfo(serial))
  handle(IpcChannel.AdbStatus, () => deviceManager?.getStatus() ?? ctx.fallbackStatus)

  handle(IpcChannel.AdbConnect, async (_e, address: string) => {
    if (!adb) throw new Error('未找到 adb')
    if (!/^[\w.-]+(:\d{1,5})?$/.test(address)) throw new Error('地址格式应为 host:port')
    return adb.connect(address)
  })
  handle(IpcChannel.AdbDisconnect, async (_e, serial: string) => {
    if (!adb) throw new Error('未找到 adb')
    return adb.disconnect(serial)
  })

  handle(IpcChannel.MirrorStart, (event, serial: string, options?: MirrorOptions) => {
    if (!mirror) throw new Error('未找到 adb')
    return mirror.start(event.sender, serial, options)
  })
  handle(IpcChannel.MirrorStop, (_e, sessionId: string) => mirror?.stop(sessionId))
  ipcMain.on(IpcChannel.MirrorControl, (_e, sessionId: string, input: ControlInput) => mirror?.control(sessionId, input))

  handle(IpcChannel.TerminalOpen, (event, serial: string, options: TerminalOpenOptions) => {
    if (!shell) throw new Error('未找到 adb')
    if (!deviceManager?.list().some((d) => d.serial === serial && d.state === 'device')) throw new Error('设备不在线')
    return shell.open(event.sender, serial, options)
  })
  handle(IpcChannel.TerminalOpenSerial, (event, options: SerialOptions) => serial.open(event.sender, options))
  handle(IpcChannel.SerialList, () => serial.list())
  // 终端 id 全局唯一，各服务只处理自己的会话
  ipcMain.on(IpcChannel.TerminalWrite, (_e, id: string, data: string) => {
    shell?.write(id, data)
    serial.write(id, data)
  })
  ipcMain.on(IpcChannel.TerminalResize, (_e, id: string, cols: number, rows: number) => shell?.resize(id, cols, rows))
  handle(IpcChannel.TerminalClose, (_e, id: string) => {
    shell?.close(id)
    serial.close(id)
  })

  handle(IpcChannel.DevicesPackages, (_e, serial: string) => requireFiles().packages(serial))
  handle(IpcChannel.FilesList, (_e, serial: string, dir: string) => requireFiles().list(serial, dir))
  handle(IpcChannel.FilesPush, async (event, serial: string, localPaths: string[], remoteDir: string, transferId?: string) => {
    const controller = new AbortController()
    const id = transferId ?? randomUUID()
    transfers.set(id, { serial, controller })
    try {
      const results = await requireFiles().push(
        serial,
        localPaths,
        remoteDir,
        (progress) => {
          if (transferId && !event.sender.isDestroyed()) event.sender.send(IpcChannel.FilesProgress, { transferId, ...progress })
        },
        controller.signal
      )
      return results.map((r) => ({ ...r, message: translateError(r.message) }))
    } finally {
      transfers.delete(id)
    }
  })
  ipcMain.on(IpcChannel.FilesCancel, (_e, transferId: string) => transfers.get(transferId)?.controller.abort())
  handle(IpcChannel.FilesDiskUsage, (_e, serial: string, dir: string, asRoot: boolean) => requireFiles().diskUsage(serial, String(dir), Boolean(asRoot)))
  handle(IpcChannel.FilesSaveText, async (event, defaultName: string, text: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: tm('保存日志'),
      defaultPath: String(defaultName),
      filters: [
        { name: tm('文本文件'), extensions: ['txt', 'log'] },
        { name: tm('所有文件'), extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, String(text), 'utf8')
    return result.filePath
  })
  handle(IpcChannel.AppsPids, (_e, serial: string, pkg: string) => requireApps().pids(serial, String(pkg)))
  handle(IpcChannel.DeviceSaveImage, async (event, png: Uint8Array, label: string, saveAs: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return requireApps().saveImage(Buffer.from(png), String(label), saveAs ? { window: win, title: tm('保存截图'), filterName: tm('图片') } : undefined)
  })
  ipcMain.on(IpcChannel.AppSetLanguage, (_e, language: 'zh' | 'en') => setLanguage(language))
  handle(IpcChannel.FilesPickApk, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: tm('选择要安装的 APK'),
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: tm('Android 应用'), extensions: ['apk'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  handle(IpcChannel.AppsList, (_e, serial: string) => requireApps().list(serial))
  handle(IpcChannel.AppsRun, (_e, serial: string, pkg: string, action: AppAction, kind: AppPackage['kind']) =>
    requireApps().run(serial, pkg, action, kind)
  )
  handle(IpcChannel.AppsExport, (_e, serial: string, pkg: string, apkPath: string, localDir: string) =>
    requireApps().exportApk(serial, pkg, apkPath, localDir)
  )
  handle(IpcChannel.AppsInstall, (_e, serial: string, apkPaths: string[]) => requireApps().install(serial, apkPaths))
  handle(IpcChannel.DeviceScreenshot, (_e, serial: string) => requireApps().screenshot(serial))
  handle(IpcChannel.FilesPull, async (_e, serial: string, remotePath: string, localDir: string) => {
    const result = await requireFiles().pull(serial, remotePath, localDir)
    return { ...result, message: translateError(result.message) }
  })
  handle(IpcChannel.FilesPickLocal, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: tm('选择要上传的文件'), properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  handle(IpcChannel.FilesPickDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: tm('选择保存位置'), properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.on(IpcChannel.FilesReveal, (_e, path: string) => electronShell.showItemInFolder(path))
  handle(IpcChannel.TraceUiUrl, () => perfetto.uiUrl())
  handle(IpcChannel.TraceOpen, (_e, localPath: string) => perfetto.register(String(localPath)))
  handle(IpcChannel.TracePick, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: tm('打开 trace 文件'),
      properties: ['openFile'] as Array<'openFile'>,
      filters: [
        { name: 'Trace', extensions: ['pftrace', 'perfetto-trace', 'trace', 'pb', 'json', 'gz', 'zip', 'ctrace', 'html'] },
        { name: tm('所有文件'), extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IpcChannel.TraceList, () => traces.list())
  handle(IpcChannel.TraceRemove, (_e, path: string) => traces.remove(String(path)))
  handle(IpcChannel.TraceOpenDir, async () => {
    const error = await electronShell.openPath(await traces.ensureDir())
    if (error) throw new Error(error)
  })
  handle(IpcChannel.TraceRecordStart, (_e, serial: string, options: TraceRecordOptions, label: string) => {
    if (!recorder) throw new Error('未找到 adb')
    return recorder.start(serial, options, String(label))
  })
  handle(IpcChannel.TraceRecordStop, (_e, serial: string) => recorder?.stop(serial))
  handle(IpcChannel.TraceRecordList, () => recorder?.list() ?? [])
  handle(IpcChannel.ThemeGet, () => loadTheme())
  handle(IpcChannel.ThemeSet, (_e, mode: ThemeMode) => setTheme(mode))
  handle(IpcChannel.ClipboardRead, () => clipboard.readText())
  ipcMain.on(IpcChannel.ClipboardWrite, (_e, text: string) => clipboard.writeText(String(text)))

  handle(IpcChannel.MetricsSnapshot, (_e, serial: string) => metrics?.snapshot(serial) ?? { serial, history: [] })

  deviceManager?.on('devices', (devices) => {
    const online = new Set(devices.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const transfer of transfers.values()) if (!online.has(transfer.serial)) transfer.controller.abort()
    mirror?.onDevicesChanged(devices)
    shell?.onDevicesChanged(devices)
    metrics?.onDevicesChanged(devices)
    recorder?.onDevicesChanged(devices)
    broadcast(IpcChannel.DevicesChanged, devices)
  })
  deviceManager?.on('status', (status) => broadcast(IpcChannel.AdbStatusChanged, status))
}
