import type { MetricsEvent, MetricsSnapshot } from './metrics'
import type { ControlInput, MirrorEvent, MirrorOptions, MirrorSessionInfo } from './mirror'
import type { AdbStatus, Device } from './models'
import type { TerminalEvent, TerminalOpenOptions, TerminalSessionInfo } from './terminal'
import type { SerialOptions, SerialPortInfo } from './serial'

/** 所有 IPC 通道名集中定义，主进程与 preload 共用 */
export const IpcChannel = {
  DevicesList: 'devices:list',
  DevicesChanged: 'devices:changed',
  DevicesRefreshInfo: 'devices:refreshInfo',
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
  metrics: {
    /** 当前缓冲的历史与最近一次进程、存储数据 */
    snapshot(serial: string): Promise<MetricsSnapshot>
    /** 所有在线设备的实时推送 */
    onEvent(listener: (event: MetricsEvent) => void): () => void
  }
}
