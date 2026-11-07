import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import type { AdbStatus } from '@shared/models'
import { AdbClient } from './adb/AdbClient'
import { resolveAdbPath } from './adb/adbPath'
import { DeviceManager } from './devices/DeviceManager'
import { broadcast, registerIpc } from './ipc'
import { MirrorService } from './mirror/MirrorService'
import { ShellService } from './shell/ShellService'
import { MetricsService } from './metrics/MetricsService'
import { SerialService } from './serial/SerialService'
import { FileService } from './files/FileService'
import { AppService } from './apps/AppService'
import { IpcChannel } from '@shared/ipc'
import { applyTheme, loadTheme, windowBackground } from './theme'
import { PerfettoUiServer } from './trace/PerfettoUiServer'
import { TraceLibrary } from './trace/TraceLibrary'
import { TraceRecorder } from './trace/TraceRecorder'
import { RootService } from './root/RootService'
import { RootSettingsStore } from './root/RootSettingsStore'
import { OperationLog } from './oplog/OperationLog'
import { safeStorage } from 'electron'

let deviceManager: DeviceManager | undefined
let mirror: MirrorService | undefined
let shellService: ShellService | undefined
let metrics: MetricsService | undefined
let files: FileService | undefined
let apps: AppService | undefined
const serial = new SerialService()
let perfetto: PerfettoUiServer | undefined
let recorder: TraceRecorder | undefined
let rootService: RootService | undefined

/** 开发时为项目根目录下的 resources/，打包后为 extraResources 目录 */
function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Cockpit',
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 应用里没有需要拼写检查的输入框，关掉可省下词典和检查服务的内存
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  const adbPath = await resolveAdbPath({ bundledDir: app.isPackaged ? process.resourcesPath : undefined })
  let adb: AdbClient | undefined
  const oplog = new OperationLog((event) => broadcast(IpcChannel.OplogEvent, event))
  const rootSettings = new RootSettingsStore(join(app.getPath('userData'), 'root-settings.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64'))
  })
  let fallbackStatus: AdbStatus = { path: null, tracking: false, error: '未找到 adb，请安装 Android SDK platform-tools 或设置 ANDROID_HOME' }

  if (adbPath) {
    adb = new AdbClient(adbPath)
    let version: string | undefined
    try {
      version = await adb.version()
    } catch (error) {
      fallbackStatus = { path: adbPath, tracking: false, error: (error as Error).message }
    }
    deviceManager = new DeviceManager(adb, version)
    mirror = new MirrorService(adb, join(resourcesDir(), 'scrcpy-server'))
    const devices = deviceManager
    const roots = new RootService(
      adb,
      rootSettings,
      (serial, method) => devices.setRootSession(serial, method),
      (serial) => void devices.refreshInfo(serial)
    )
    rootService = roots
    shellService = new ShellService(adbPath, (serial, root) => devices.setShellRoot(serial, root), roots)
    metrics = new MetricsService(
      adb,
      (event) => broadcast(IpcChannel.MetricsEvent, event),
      (serial) => {
        const session = roots.session(serial)
        return session ? (command, timeout) => session.exec(command, timeout, false) : undefined
      }
    )
    files = new FileService(adb, (serial) => roots.session(serial))
    apps = new AppService(adb)
  }
  // 没有 adb 时也能开本机终端
  shellService ??= new ShellService(null)
  const traces = new TraceLibrary(join(app.getPath('documents'), 'Cockpit', 'Traces'), (path) => shell.trashItem(path))
  if (adb && deviceManager && metrics) {
    const manager = deviceManager
    const poller = metrics
    recorder = new TraceRecorder(
      adb,
      traces,
      (serial) => manager.list().find((d) => d.serial === serial),
      (serial, paused) => poller.setPaused(serial, paused),
      (event) => broadcast(IpcChannel.TraceRecordEvent, event)
    )
  }

  perfetto = new PerfettoUiServer(join(resourcesDir(), 'perfetto-ui'))
  registerIpc({
    adb,
    deviceManager,
    mirror,
    shell: shellService,
    metrics,
    files,
    apps,
    serial,
    perfetto,
    traces,
    recorder,
    root: rootService,
    rootSettings,
    oplog,
    fallbackStatus
  })
  createWindow()
  void deviceManager?.start()
}

// 主进程里漏掉的异常不让应用崩溃或弹系统对话框，记录后推给界面提示
function reportMainError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[main]', error)
  broadcast(IpcChannel.AppError, message)
}
process.on('uncaughtException', reportMainError)
process.on('unhandledRejection', reportMainError)

app.whenReady().then(() => {
  // 在建窗口前应用保存的主题，首帧就是正确的底色
  applyTheme(loadTheme())
  void bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  mirror?.dispose()
  shellService?.dispose()
  rootService?.dispose()
  metrics?.dispose()
  serial.dispose()
  perfetto?.dispose()
  recorder?.dispose()
  deviceManager?.dispose()
})
