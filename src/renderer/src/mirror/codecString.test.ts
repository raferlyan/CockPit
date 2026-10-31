import { describe, expect, it } from 'vitest'
import { findNal, h264CodecString } from './codecString'

describe('h264CodecString', () => {
  it('reads profile/constraints/level from the SPS', () => {
    // 00 00 00 01 | SPS: 67 42 C0 1F ... | 00 00 00 01 | PPS: 68 CE 3C 80
    const config = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xda, 0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80])
    expect(h264CodecString(config)).toBe('avc1.42c01f')
    expect([...findNal(config, 8)!]).toEqual([0x68, 0xce, 0x3c, 0x80])
    expect([...findNal(config, 7)!]).toEqual([0x67, 0x42, 0xc0, 0x1f, 0xda])
  })

  it('returns undefined without SPS', () => {
    expect(h264CodecString(new Uint8Array([0, 0, 1, 0x68, 1]))).toBeUndefined()
  })
})
