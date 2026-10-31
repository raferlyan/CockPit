/** 投屏相关的共享类型（主进程 / 渲染进程 / 解码 Worker） */

export type VideoCodec = 'h264' | 'h265'

export interface MirrorOptions {
  /** 长边最大像素，0 表示不限制 */
  maxSize?: number
  /** bps */
  videoBitRate?: number
  maxFps?: number
  videoCodec?: VideoCodec
  /** 投屏期间保持设备唤醒（仅插电时有效） */
  stayAwake?: boolean
}

export const DEFAULT_MIRROR_OPTIONS: Required<MirrorOptions> = {
  maxSize: 1280,
  videoBitRate: 6_000_000,
  maxFps: 60,
  videoCodec: 'h264',
  stayAwake: false
}

export interface MirrorSessionInfo {
  sessionId: string
  serial: string
  deviceName: string
  codec: VideoCodec
}

/** 主进程经 MessagePort 发给解码 Worker 的视频消息 */
export type VideoMessage =
  | { type: 'codec'; codec: VideoCodec }
  /** 视频尺寸（会话开始、旋转时下发）；触控坐标必须基于这个尺寸 */
  | { type: 'session'; width: number; height: number }
  | { type: 'packet'; config: boolean; key: boolean; pts: number; data: Uint8Array }
  | { type: 'end'; error?: string }

export type KeyAction = 'down' | 'up'
export type TouchAction = 'down' | 'up' | 'move'

/** 渲染进程发给主进程的控制输入，由主进程序列化为 scrcpy 控制消息 */
export type ControlInput =
  | { type: 'key'; action: KeyAction; keycode: number; metaState?: number; repeat?: number }
  | { type: 'text'; text: string }
  | {
      type: 'touch'
      action: TouchAction
      x: number
      y: number
      /** 当前视频尺寸，与 session 消息一致，否则设备会丢弃事件 */
      width: number
      height: number
      /** MotionEvent 按钮状态，默认按主键处理 */
      buttons?: number
      actionButton?: number
    }
  | { type: 'scroll'; x: number; y: number; width: number; height: number; hscroll: number; vscroll: number }
  | { type: 'backOrScreenOn'; action: KeyAction }
  | { type: 'expandNotificationPanel' }
  | { type: 'expandSettingsPanel' }
  | { type: 'collapsePanels' }
  | { type: 'rotateDevice' }
  | { type: 'setDisplayPower'; on: boolean }
  /** 让设备执行复制/剪切，结果通过剪贴板同步回电脑 */
  | { type: 'getClipboard'; copyKey: 'none' | 'copy' | 'cut' }
  /** 把电脑剪贴板内容发到设备并粘贴（主进程读取剪贴板） */
  | { type: 'pasteFromHost' }
  /** 把任意文本经设备剪贴板粘贴（用于中文等无法按键注入的字符） */
  | { type: 'pasteText'; text: string }
  | { type: 'resetVideo' }

export type MirrorState = 'starting' | 'running' | 'stopped' | 'error'

export type MirrorEvent =
  | { sessionId: string; type: 'state'; state: MirrorState; error?: string }
  | { sessionId: string; type: 'clipboard'; text: string }
