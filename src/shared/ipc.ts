import type { MetricsEvent, MetricsSnapshot } from './metrics'
import type { ControlInput, MirrorEvent, MirrorOptions, MirrorSessionInfo } from './mirror'
import type { AdbStatus, Device } from './models'
import type { TerminalEvent, TerminalOpenOptions, TerminalSessionInfo } from './terminal'
import type { SerialOptions, SerialPortInfo } from './serial'
import type { RemoteEntry, TransferResult } from './files'
import type { ThemeMode } from './theme'

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
  ClipboardRead: 'clipboard:read',
  ClipboardWrite: 'clipboard:write',
  ThemeGet: 'theme:get',
  ThemeSet: 'theme:set',
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
  }
  app: {
    onError(listener: (message: string) => void): () => void
  }
  theme: {
    get(): Promise<ThemeMode>
    set(mode: ThemeMode): Promise<void>
  }
  serial: {
    list(): Promise<SerialPortInfo[]>
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
    push(serial: string, localPaths: string[], remoteDir: string): Promise<TransferResult[]>
    pull(serial: string, remotePath: string, localDir: string): Promise<TransferResult>
    /** 在 Finder / 资源管理器中显示 */
    reveal(path: string): void
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
