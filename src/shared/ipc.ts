import type { MetricsEvent, MetricsSnapshot } from './metrics'
import type { ControlInput, MirrorEvent, MirrorOptions, MirrorSessionInfo, RecordingInfo } from './mirror'
import type { AdbStatus, Device } from './models'
import type { TerminalEvent, TerminalOpenOptions, TerminalSessionInfo } from './terminal'
import type { SerialOptions, SerialPortInfo } from './serial'
import type { DiskUsage, RemoteEntry, TransferProgressEvent, TransferResult } from './files'
import type { AppAction, AppPackage, InstallResult } from './apps'
import type { ThemeMode } from './theme'
import type { TraceFile, TraceRecordEvent, TraceRecordOptions, TraceSource } from './trace'
import type { DecryptToolConfig, RootMethod, RootSettings, RootSettingsUpdate } from './root'
import type { OpEntry, OpLogEvent } from './oplog'

/** 所有 IPC 通道名集中定义，主进程与 preload 共用 */
export const IpcChannel = {
  DevicesList: 'devices:list',
  DevicesChanged: 'devices:changed',
  DevicesRefreshInfo: 'devices:refreshInfo',
  DevicesPackages: 'devices:packages',
  AdbStatus: 'adb:status',
  AdbStatusChanged: 'adb:statusChanged',
  AdbConnect: 'adb:connect',
  AdbDisconnect: 'adb:disconnect',
  MirrorStart: 'mirror:start',
  MirrorStop: 'mirror:stop',
  MirrorControl: 'mirror:control',
  MirrorEvent: 'mirror:event',
  MirrorRecordStart: 'mirror:recordStart',
  MirrorRecordStop: 'mirror:recordStop',
  /** 主进程 → 渲染进程，携带视频 MessagePort */
  MirrorPort: 'mirror:port',
  TerminalOpen: 'terminal:open',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalClose: 'terminal:close',
  TerminalEvent: 'terminal:event',
  MetricsSnapshot: 'metrics:snapshot',
  MetricsEvent: 'metrics:event',
  SerialList: 'serial:list',
  TerminalOpenSerial: 'terminal:openSerial',
  FilesList: 'files:list',
  FilesPush: 'files:push',
  FilesPull: 'files:pull',
  FilesPickLocal: 'files:pickLocal',
  FilesPickDirectory: 'files:pickDirectory',
  FilesReveal: 'files:reveal',
  /** 主进程 → 渲染进程，上传进度 */
  FilesProgress: 'files:progress',
  FilesPickApk: 'files:pickApk',
  FilesCancel: 'files:cancel',
  FilesDiskUsage: 'files:diskUsage',
  FilesSaveText: 'files:saveText',
  FilesRemount: 'files:remount',
  RootSettingsGet: 'root:settingsGet',
  RootSettingsSet: 'root:settingsSet',
  RootEnter: 'root:enter',
  RootExit: 'root:exit',
  RootPickTool: 'root:pickTool',
  RootTestTool: 'root:testTool',
  OplogList: 'oplog:list',
  OplogClear: 'oplog:clear',
  /** 主进程 → 渲染进程，操作日志新增或更新 */
  OplogEvent: 'oplog:event',
  AppsPids: 'apps:pids',
  DeviceSaveImage: 'device:saveImage',
  AppSetLanguage: 'app:setLanguage',
  AppsList: 'apps:list',
  AppsRun: 'apps:run',
  AppsExport: 'apps:export',
  AppsInstall: 'apps:install',
  DeviceScreenshot: 'device:screenshot',
  ClipboardRead: 'clipboard:read',
  ClipboardWrite: 'clipboard:write',
  ThemeGet: 'theme:get',
  ThemeSet: 'theme:set',
  TraceUiUrl: 'trace:uiUrl',
  TraceOpen: 'trace:open',
  TracePick: 'trace:pick',
  TraceList: 'trace:list',
  TraceRemove: 'trace:remove',
  TraceOpenDir: 'trace:openDir',
  TraceRecordStart: 'trace:recordStart',
  TraceRecordStop: 'trace:recordStop',
  TraceRecordList: 'trace:recordList',
  /** 主进程 → 渲染进程，录制进度 */
  TraceRecordEvent: 'trace:recordEvent',
  /** 主进程未捕获的异常，推给界面提示 */
  AppError: 'app:error'
} as const

/** preload 通过 window.postMessage 把视频端口转交给页面时使用的消息标记 */
export const MIRROR_PORT_MESSAGE = 'cockpit:mirror-port'

/** preload 通过 contextBridge 暴露给渲染进程的 API */
export interface CockpitApi {
  /** process.platform，如 darwin / win32 */
  platform: string
  devices: {
    list(): Promise<Device[]>
    refreshInfo(serial: string): Promise<void>
    /** 已安装应用的包名（pm list packages） */
    packages(serial: string): Promise<string[]>
    onChanged(listener: (devices: Device[]) => void): () => void
  }
  adb: {
    status(): Promise<AdbStatus>
    onStatusChanged(listener: (status: AdbStatus) => void): () => void
    /** `adb connect host:port`，返回 adb 的输出文本 */
    connect(address: string): Promise<string>
    disconnect(serial: string): Promise<string>
  }
  mirror: {
    /**
     * 启动投屏。视频 MessagePort 通过 window 的 message 事件送达，
     * data 为 `{ type: MIRROR_PORT_MESSAGE, sessionId }`。
     */
    start(serial: string, options?: MirrorOptions): Promise<MirrorSessionInfo>
    stop(sessionId: string): Promise<void>
    /** 高频调用（鼠标移动），不等待结果 */
    control(sessionId: string, input: ControlInput): void
    onEvent(listener: (event: MirrorEvent) => void): () => void
    /** 开始录屏，保存到「影片/Cockpit」 */
    startRecording(sessionId: string): Promise<{ startedAt: number }>
    stopRecording(sessionId: string): Promise<RecordingInfo>
  }
  app: {
    onError(listener: (message: string) => void): () => void
    /** 整体界面缩放（字号、间距一起放大），1 为原始大小 */
    setZoom(factor: number): void
    /** 主进程的对话框标题、错误信息跟随界面语言 */
    setLanguage(language: 'zh' | 'en'): void
  }
  apps: {
    /** 全量扫描设备上的应用（含系统应用、已对当前用户卸载的系统应用） */
    list(serial: string): Promise<AppPackage[]>
    /** 卸载、恢复、停用、启用、强制停止、清除数据；返回 pm 的输出 */
    run(serial: string, pkg: string, action: AppAction, kind: AppPackage['kind']): Promise<string>
    /** 把 base.apk 下载到本机目录，返回本机文件路径 */
    exportApk(serial: string, pkg: string, apkPath: string, localDir: string): Promise<string>
    install(serial: string, apkPaths: string[]): Promise<InstallResult[]>
    /** 包名对应的进程号（pidof），没在运行时为空数组 */
    pids(serial: string, pkg: string): Promise<number[]>
  }
  device: {
    /** 原始分辨率截图，返回 PNG 数据，由用户决定直接保存还是编辑后保存 */
    screenshot(serial: string): Promise<Uint8Array>
    /**
     * 保存 PNG 并复制到剪贴板：saveAs 为 false 时存到「图片/Cockpit」，
     * 为 true 时弹出另存为对话框（取消时返回 null）；返回文件路径。
     */
    saveImage(png: Uint8Array, label: string, saveAs: boolean): Promise<string | null>
  }
  theme: {
    get(): Promise<ThemeMode>
    set(mode: ThemeMode): Promise<void>
  }
  serial: {
    list(): Promise<SerialPortInfo[]>
  }
  trace: {
    /** 内嵌 Perfetto UI 的地址，首次调用时启动本地服务 */
    uiUrl(): Promise<string>
    /** 登记本机 trace 文件，返回 Perfetto 可以加载的地址 */
    open(localPath: string): Promise<TraceSource>
    /** 系统对话框选择 trace 文件，取消时返回 null */
    pick(): Promise<string | null>
    /** trace 目录里的文件，新的在前 */
    list(): Promise<TraceFile[]>
    /** 移到废纸篓，只能操作 trace 目录里的文件 */
    remove(path: string): Promise<void>
    /** 在 Finder / 资源管理器中打开 trace 目录 */
    openDir(): Promise<void>
    /** 开始录制；进度通过 onRecordEvent 推送，label 用作文件名前缀 */
    record(serial: string, options: TraceRecordOptions, label: string): Promise<void>
    /** 提前结束录制，已录到的部分照常保存 */
    stopRecord(serial: string): Promise<void>
    /** 正在进行的录制 */
    recordings(): Promise<TraceRecordEvent[]>
    onRecordEvent(listener: (event: TraceRecordEvent) => void): () => void
  }
  terminal: {
    open(serial: string, options: TerminalOpenOptions): Promise<TerminalSessionInfo>
    /** 打开本机串口，输出与按键走与 adb 终端相同的事件和方法 */
    openSerial(options: SerialOptions, size: { cols: number; rows: number }): Promise<TerminalSessionInfo>
    /** 键盘输入，不等待结果 */
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    close(id: string): Promise<void>
    onEvent(listener: (event: TerminalEvent) => void): () => void
  }
  files: {
    /** 拖拽进来的 File 对应的本机绝对路径（Electron 不再提供 File.path） */
    pathForFile(file: File): string
    /** 系统对话框选择本机文件，取消时返回空数组 */
    pickLocal(): Promise<string[]>
    /** 系统对话框选择本机目录，取消时返回 null */
    pickDirectory(): Promise<string | null>
    list(serial: string, dir: string): Promise<RemoteEntry[]>
    /** transferId 用来在 onProgress 里认出本次上传的进度 */
    push(serial: string, localPaths: string[], remoteDir: string, transferId?: string): Promise<TransferResult[]>
    /** 取消进行中的上传，push 会尽快返回，未完成的文件标记为已取消 */
    cancel(transferId: string): void
    /** 统计目录下一层各项的占用 */
    diskUsage(serial: string, dir: string, asRoot: boolean): Promise<DiskUsage>
    /** 把只读分区重新挂载为可写，返回结果说明 */
    remount(serial: string, mountPoint: string): Promise<string>
    /** 弹出保存对话框把文本写到本机，取消时返回 null */
    saveText(defaultName: string, text: string): Promise<string | null>
    onProgress(listener: (event: TransferProgressEvent) => void): () => void
    /** 系统对话框选择 APK，取消时返回空数组 */
    pickApk(): Promise<string[]>
    pull(serial: string, remotePath: string, localDir: string): Promise<TransferResult>
    /** 在 Finder / 资源管理器中显示 */
    reveal(path: string): void
  }
  root: {
    getSettings(): Promise<RootSettings>
    setSettings(patch: RootSettingsUpdate): Promise<RootSettings>
    /** 进入 root，method 为空时用该设备的配置；返回实际使用的方式 */
    enter(serial: string, method?: RootMethod): Promise<RootMethod>
    exit(serial: string): Promise<void>
    /** 系统对话框选择解密工具，取消时返回 null */
    pickTool(): Promise<string | null>
    /** 用一个挑战码试运行解密工具，返回它算出的密码 */
    testTool(config: DecryptToolConfig, challenge: string): Promise<string>
  }
  oplog: {
    list(): Promise<OpEntry[]>
    clear(): Promise<void>
    onEvent(listener: (event: OpLogEvent) => void): () => void
  }
  /** 走主进程的系统剪贴板，不受页面焦点和权限限制 */
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): void
  }
  metrics: {
    /** 当前缓冲的历史与最近一次进程、存储数据 */
    snapshot(serial: string): Promise<MetricsSnapshot>
    /** 所有在线设备的实时推送 */
    onEvent(listener: (event: MetricsEvent) => void): () => void
  }
}
