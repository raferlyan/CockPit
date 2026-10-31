import { describe, expect, it } from 'vitest'
import {
  DeviceMessageParser,
  parseCodecId,
  parseDeviceName,
  serializeControl,
  truncateUtf8,
  VideoStreamParser
} from './protocol'

function mediaHeader(ptsAndFlags: bigint, size: number): Buffer {
  const buf = Buffer.alloc(12)
  buf.writeBigUInt64BE(ptsAndFlags)
  buf.writeUInt32BE(size, 8)
  return buf
}

function sessionHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(12)
  buf.writeUInt32BE(0x8000_0000)
  buf.writeUInt32BE(width, 4)
  buf.writeUInt32BE(height, 8)
  return buf
}

describe('handshake fields', () => {
  it('parses device name and codec id', () => {
    const field = Buffer.alloc(64)
    field.write('GM1910')
    expect(parseDeviceName(field)).toBe('GM1910')
    expect(parseCodecId(Buffer.from('h264'))).toBe('h264')
    expect(parseCodecId(Buffer.from('h265'))).toBe('h265')
    expect(() => parseCodecId(Buffer.from([0, 0, 0, 1]))).toThrow('配置错误')
  })
})

describe('VideoStreamParser', () => {
  it('parses session, config and key frame packets across chunk boundaries', () => {
    const stream = Buffer.concat([
      sessionHeader(576, 1248),
      mediaHeader(1n << 62n, 3),
      Buffer.from([1, 2, 3]),
      mediaHeader((1n << 61n) | 1000n, 4),
      Buffer.from([4, 5, 6, 7]),
      mediaHeader(2000n, 2),
      Buffer.from([8, 9])
    ])

    const parser = new VideoStreamParser()
    const messages = []
    // 每次只喂 5 字节，模拟 TCP 分片
    for (let i = 0; i < stream.length; i += 5) messages.push(...parser.push(stream.subarray(i, i + 5)))

    expect(messages).toEqual([
      { type: 'session', width: 576, height: 1248 },
      { type: 'packet', config: true, key: false, pts: 0, data: new Uint8Array([1, 2, 3]) },
      { type: 'packet', config: false, key: true, pts: 1000, data: new Uint8Array([4, 5, 6, 7]) },
      { type: 'packet', config: false, key: false, pts: 2000, data: new Uint8Array([8, 9]) }
    ])
  })

  it('copies packet data into its own buffer', () => {
    const parser = new VideoStreamParser()
    const [msg] = parser.push(Buffer.concat([mediaHeader(5n, 2), Buffer.from([1, 2]), Buffer.alloc(8)]))
    expect(msg.type === 'packet' && msg.data.buffer.byteLength).toBe(2)
  })
})

describe('serializeControl', () => {
  it('serializes keycode (14 bytes)', () => {
    const buf = serializeControl({ type: 'key', action: 'up', keycode: 3, repeat: 1, metaState: 0x1000 })
    expect([...buf]).toEqual([0, 1, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0x10, 0])
  })

  it('serializes touch down with mouse pointer id (32 bytes)', () => {
    const buf = serializeControl({ type: 'touch', action: 'down', x: 100, y: 200, width: 576, height: 1248 })
    expect(buf.length).toBe(32)
    expect(buf[0]).toBe(2)
    expect(buf[1]).toBe(0)
    expect(buf.subarray(2, 10).toString('hex')).toBe('ffffffffffffffff')
    expect(buf.readInt32BE(10)).toBe(100)
    expect(buf.readInt32BE(14)).toBe(200)
    expect(buf.readUInt16BE(18)).toBe(576)
    expect(buf.readUInt16BE(20)).toBe(1248)
    expect(buf.readUInt16BE(22)).toBe(0xffff)
    expect(buf.readInt32BE(24)).toBe(1)
    expect(buf.readInt32BE(28)).toBe(1)
  })

  it('serializes touch up with zero pressure and buttons', () => {
    const buf = serializeControl({ type: 'touch', action: 'up', x: 1, y: 2, width: 10, height: 20 })
    expect(buf.readUInt16BE(22)).toBe(0)
    expect(buf.readInt32BE(24)).toBe(1)
    expect(buf.readInt32BE(28)).toBe(0)
  })

  it('serializes scroll (21 bytes) with normalized fixed-point values', () => {
    const buf = serializeControl({ type: 'scroll', x: 5, y: 6, width: 100, height: 200, hscroll: 0, vscroll: -16 })
    expect(buf.length).toBe(21)
    expect(buf[0]).toBe(3)
    expect(buf.readInt16BE(13)).toBe(0)
    expect(buf.readInt16BE(15)).toBe(-0x8000)
  })

  it('serializes text and clipboard with length prefix', () => {
    expect([...serializeControl({ type: 'text', text: 'ab' })]).toEqual([1, 0, 0, 0, 2, 0x61, 0x62])
    const clip = serializeControl({ type: 'setClipboard', text: '你', paste: true }, 7n)
    expect(clip[0]).toBe(9)
    expect(clip.readBigUInt64BE(1)).toBe(7n)
    expect(clip[9]).toBe(1)
    expect(clip.readUInt32BE(10)).toBe(3)
    expect(clip.toString('utf8', 14)).toBe('你')
  })

  it('serializes simple commands', () => {
    expect([...serializeControl({ type: 'backOrScreenOn', action: 'down' })]).toEqual([4, 0])
    expect([...serializeControl({ type: 'rotateDevice' })]).toEqual([11])
    expect([...serializeControl({ type: 'resetVideo' })]).toEqual([17])
    expect([...serializeControl({ type: 'getClipboard', copyKey: 'copy' })]).toEqual([8, 1])
    expect([...serializeControl({ type: 'setDisplayPower', on: false })]).toEqual([10, 0])
  })
})

describe('truncateUtf8', () => {
  it('does not split multi-byte characters', () => {
    expect(truncateUtf8('a你好', 5).toString()).toBe('a你')
    expect(truncateUtf8('abc', 10).toString()).toBe('abc')
  })
})

describe('DeviceMessageParser', () => {
  it('parses clipboard and ack messages split across chunks', () => {
    const text = Buffer.from('复制的内容')
    const clip = Buffer.concat([Buffer.from([0]), Buffer.alloc(4), text])
    clip.writeUInt32BE(text.length, 1)
    const ack = Buffer.alloc(9)
    ack[0] = 1
    ack.writeBigUInt64BE(42n, 1)

    const parser = new DeviceMessageParser()
    const all = Buffer.concat([clip, ack])
    const out = [...parser.push(all.subarray(0, 7)), ...parser.push(all.subarray(7))]
    expect(out).toEqual([
      { type: 'clipboard', text: '复制的内容' },
      { type: 'ackClipboard', sequence: 42n }
    ])
  })
})
