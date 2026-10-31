import type { ControlInput, VideoCodec, VideoMessage } from '@shared/mirror'

/*
 * scrcpy v5 协议实现，对应 server 源码：
 *   device/Streamer.java、device/DesktopConnection.java、
 *   control/ControlMessageReader.java、control/DeviceMessageWriter.java
 */

export const DEVICE_NAME_FIELD_LENGTH = 64

const CODEC_IDS: Record<number, VideoCodec> = {
  0x68323634: 'h264', // "h264"
  0x68323635: 'h265' // "h265"
}

const FLAG_SESSION = 1n << 63n
const FLAG_CONFIG = 1n << 62n
const FLAG_KEY_FRAME = 1n << 61n
const PTS_MASK = FLAG_KEY_FRAME - 1n
const HEADER_SIZE = 12

export function parseDeviceName(field: Buffer): string {
  const end = field.indexOf(0)
  return field.toString('utf8', 0, end === -1 ? field.length : end)
}

export function parseCodecId(raw: Buffer): VideoCodec {
  const id = raw.readUInt32BE(0)
  if (id === 0) throw new Error('设备禁用了视频流')
  if (id === 1) throw new Error('设备端视频配置错误')
  const codec = CODEC_IDS[id]
  if (!codec) throw new Error(`不支持的视频编码 0x${id.toString(16)}`)
  return codec
}

/**
 * 解析 codec id 之后的视频流：
 * - 会话包：12 字节头，首位为 1，后跟宽、高，无负载
 * - 媒体包：8 字节 PTS+标志位 + 4 字节长度 + 负载
 */
export class VideoStreamParser {
  private buffer: Buffer = Buffer.alloc(0)
  private pending?: { config: boolean; key: boolean; pts: number; size: number }

  push(chunk: Buffer): VideoMessage[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const out: VideoMessage[] = []

    for (;;) {
      if (!this.pending) {
        if (this.buffer.length < HEADER_SIZE) break
        const head = this.buffer.readBigUInt64BE(0)
        if (head & FLAG_SESSION) {
          out.push({ type: 'session', width: this.buffer.readUInt32BE(4), height: this.buffer.readUInt32BE(8) })
          this.buffer = this.buffer.subarray(HEADER_SIZE)
          continue
        }
        const size = this.buffer.readUInt32BE(8)
        if (size === 0) throw new Error('非法的视频包长度 0')
        const config = (head & FLAG_CONFIG) !== 0n
        this.pending = {
          config,
          key: (head & FLAG_KEY_FRAME) !== 0n,
          pts: config ? 0 : Number(head & PTS_MASK),
          size
        }
        this.buffer = this.buffer.subarray(HEADER_SIZE)
      }

      const { size, config, key, pts } = this.pending
      if (this.buffer.length < size) break
      // 复制出独立的 ArrayBuffer，避免跨进程传输时带上整个底层缓冲
      const data = new Uint8Array(this.buffer.subarray(0, size))
      out.push({ type: 'packet', config, key, pts, data })
      this.buffer = this.buffer.subarray(size)
      this.pending = undefined
    }

    return out
  }
}

/* ---------------- 控制消息（电脑 → 设备） ---------------- */

const enum ControlType {
  InjectKeycode = 0,
  InjectText = 1,
  InjectTouch = 2,
  InjectScroll = 3,
  BackOrScreenOn = 4,
  ExpandNotificationPanel = 5,
  ExpandSettingsPanel = 6,
  CollapsePanels = 7,
  GetClipboard = 8,
  SetClipboard = 9,
  SetDisplayPower = 10,
  RotateDevice = 11,
  ResetVideo = 17
}

export const POINTER_ID_MOUSE = 0xffff_ffff_ffff_ffffn // -1
export const BUTTON_PRIMARY = 1

const TEXT_MAX_LENGTH = 300
const CLIPBOARD_TEXT_MAX_LENGTH = (1 << 18) - 14

const KEY_ACTION = { down: 0, up: 1 } as const
const TOUCH_ACTION = { down: 0, up: 1, move: 2 } as const
const COPY_KEY = { none: 0, copy: 1, cut: 2 } as const

/** 按 UTF-8 字节截断，不切断多字节字符 */
export function truncateUtf8(text: string, maxBytes: number): Buffer {
  const raw = Buffer.from(text, 'utf8')
  if (raw.length <= maxBytes) return raw
  let end = maxBytes
  // 回退到字符起始字节（非 10xxxxxx）
  while (end > 0 && (raw[end] & 0xc0) === 0x80) end--
  return raw.subarray(0, end)
}

function floatToU16fp(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 1)
  return Math.min(Math.round(clamped * 0x10000), 0xffff)
}

function floatToI16fp(value: number): number {
  const clamped = Math.min(Math.max(value, -1), 1)
  return Math.max(Math.min(Math.round(clamped * 0x8000), 0x7fff), -0x8000)
}

function writePosition(buf: Buffer, offset: number, p: { x: number; y: number; width: number; height: number }): void {
  buf.writeInt32BE(Math.round(p.x), offset)
  buf.writeInt32BE(Math.round(p.y), offset + 4)
  buf.writeUInt16BE(p.width, offset + 8)
  buf.writeUInt16BE(p.height, offset + 10)
}

function withLengthPrefixedText(head: Buffer, text: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(text.length)
  return Buffer.concat([head, len, text])
}

/**
 * 序列化控制消息。pasteFromHost 需要主进程先读剪贴板，转成 setClipboard 再调用。
 * @param sequence SET_CLIPBOARD 的序号，设备完成后回 ACK
 */
export function serializeControl(
  input: Exclude<ControlInput, { type: 'pasteFromHost' } | { type: 'pasteText' }> | { type: 'setClipboard'; text: string; paste: boolean },
  sequence = 0n
): Buffer {
  switch (input.type) {
    case 'key': {
      const buf = Buffer.alloc(14)
      buf[0] = ControlType.InjectKeycode
      buf[1] = KEY_ACTION[input.action]
      buf.writeInt32BE(input.keycode, 2)
      buf.writeInt32BE(input.repeat ?? 0, 6)
      buf.writeInt32BE(input.metaState ?? 0, 10)
      return buf
    }
    case 'text':
      return withLengthPrefixedText(Buffer.from([ControlType.InjectText]), truncateUtf8(input.text, TEXT_MAX_LENGTH))
    case 'touch': {
      const buf = Buffer.alloc(32)
      buf[0] = ControlType.InjectTouch
      buf[1] = TOUCH_ACTION[input.action]
      buf.writeBigUInt64BE(POINTER_ID_MOUSE, 2)
      writePosition(buf, 10, input)
      buf.writeUInt16BE(floatToU16fp(input.action === 'up' ? 0 : 1), 22)
      const actionButton = input.actionButton ?? (input.action === 'move' ? 0 : BUTTON_PRIMARY)
      const buttons = input.buttons ?? (input.action === 'up' ? 0 : BUTTON_PRIMARY)
      buf.writeInt32BE(actionButton, 24)
      buf.writeInt32BE(buttons, 28)
      return buf
    }
    case 'scroll': {
      const buf = Buffer.alloc(21)
      buf[0] = ControlType.InjectScroll
      writePosition(buf, 1, input)
      // 与 scrcpy 客户端一致：接受 [-16, 16]，归一化到 [-1, 1]
      buf.writeInt16BE(floatToI16fp(input.hscroll / 16), 13)
      buf.writeInt16BE(floatToI16fp(input.vscroll / 16), 15)
      buf.writeInt32BE(0, 17)
      return buf
    }
    case 'backOrScreenOn':
      return Buffer.from([ControlType.BackOrScreenOn, KEY_ACTION[input.action]])
    case 'expandNotificationPanel':
      return Buffer.from([ControlType.ExpandNotificationPanel])
    case 'expandSettingsPanel':
      return Buffer.from([ControlType.ExpandSettingsPanel])
    case 'collapsePanels':
      return Buffer.from([ControlType.CollapsePanels])
    case 'rotateDevice':
      return Buffer.from([ControlType.RotateDevice])
    case 'resetVideo':
      return Buffer.from([ControlType.ResetVideo])
    case 'setDisplayPower':
      return Buffer.from([ControlType.SetDisplayPower, input.on ? 1 : 0])
    case 'getClipboard':
      return Buffer.from([ControlType.GetClipboard, COPY_KEY[input.copyKey]])
    case 'setClipboard': {
      const head = Buffer.alloc(10)
      head[0] = ControlType.SetClipboard
      head.writeBigUInt64BE(sequence, 1)
      head[9] = input.paste ? 1 : 0
      return withLengthPrefixedText(head, truncateUtf8(input.text, CLIPBOARD_TEXT_MAX_LENGTH))
    }
  }
}

/* ---------------- 设备消息（设备 → 电脑） ---------------- */

export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ackClipboard'; sequence: bigint }
  | { type: 'uhidOutput'; id: number; data: Buffer }

export class DeviceMessageParser {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): DeviceMessage[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const out: DeviceMessage[] = []
    for (;;) {
      const parsed = this.parseOne()
      if (!parsed) break
      out.push(parsed.message)
      this.buffer = this.buffer.subarray(parsed.length)
    }
    return out
  }

  private parseOne(): { message: DeviceMessage; length: number } | undefined {
    const buf = this.buffer
    if (buf.length < 1) return undefined
    switch (buf[0]) {
      case 0: {
        if (buf.length < 5) return undefined
        const len = buf.readUInt32BE(1)
        if (buf.length < 5 + len) return undefined
        return { message: { type: 'clipboard', text: buf.toString('utf8', 5, 5 + len) }, length: 5 + len }
      }
      case 1:
        if (buf.length < 9) return undefined
        return { message: { type: 'ackClipboard', sequence: buf.readBigUInt64BE(1) }, length: 9 }
      case 2: {
        if (buf.length < 5) return undefined
        const size = buf.readUInt16BE(3)
        if (buf.length < 5 + size) return undefined
        return {
          message: { type: 'uhidOutput', id: buf.readUInt16BE(1), data: Buffer.from(buf.subarray(5, 5 + size)) },
          length: 5 + size
        }
      }
      default:
        throw new Error(`未知的设备消息类型 ${buf[0]}`)
    }
  }
}
