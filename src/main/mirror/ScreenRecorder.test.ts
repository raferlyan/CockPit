import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoMessage } from '@shared/mirror'
import { avcCodecString, buildAvcC, ScreenRecorder, splitAnnexB, toLengthPrefixed } from './ScreenRecorder'

const SC = [0, 0, 0, 1]
const SPS = [0x67, 0x42, 0xc0, 0x1f, 0xda, 0x01]
const PPS = [0x68, 0xce, 0x3c, 0x80]
const IDR = [0x65, 0x88, 0x84, 0x00, 0x33]
const P = [0x41, 0x9a, 0x02, 0x44]

const packet = (bytes: number[], pts: number, extra: Partial<Extract<VideoMessage, { type: 'packet' }>> = {}): VideoMessage => ({
  type: 'packet',
  config: false,
  key: false,
  pts,
  data: new Uint8Array(bytes),
  ...extra
})

/** MP4 顶层 box 的类型列表 */
function boxes(buf: Buffer): string[] {
  const out: string[] = []
  for (let off = 0; off + 8 <= buf.length; ) {
    const size = buf.readUInt32BE(off)
    out.push(buf.toString('ascii', off + 4, off + 8))
    if (size < 8) break
    off += size
  }
  return out
}

describe('H.264 helpers', () => {
  it('splits Annex-B with 3 and 4 byte start codes', () => {
    const nals = splitAnnexB(new Uint8Array([...SC, ...SPS, 0, 0, 1, ...PPS, ...SC, ...IDR]))
    expect(nals.map((n) => Array.from(n))).toEqual([SPS, PPS, IDR])
  })

  it('builds avcC and the codec string from SPS', () => {
    const avcc = buildAvcC(new Uint8Array(SPS), new Uint8Array(PPS))
    expect(Array.from(avcc.subarray(0, 8))).toEqual([1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0, SPS.length])
    expect(avcCodecString(new Uint8Array(SPS))).toBe('avc1.42c01f')
  })

  it('length-prefixes frames and drops parameter sets', () => {
    const out = toLengthPrefixed([new Uint8Array(SPS), new Uint8Array([0x09, 0x10]), new Uint8Array(IDR)])
    expect(Array.from(out)).toEqual([0, 0, 0, IDR.length, ...IDR])
  })
})

describe('ScreenRecorder', () => {
  it('starts at the first keyframe and writes a playable MP4', async () => {
    const base = join(await mkdtemp(join(tmpdir(), 'cockpit-rec-')), 'phone')
    const rec = new ScreenRecorder(base)
    rec.push({ type: 'session', width: 1080, height: 2400 })
    rec.push(packet([...SC, ...SPS, ...SC, ...PPS], 0, { config: true }))
    rec.push(packet([...SC, ...P], 1_000)) // 关键帧之前的帧丢弃
    expect(rec.started).toBe(false)
    rec.push(packet([...SC, ...IDR], 100_000, { key: true }))
    for (let i = 1; i <= 30; i++) rec.push(packet([...SC, ...P, i], 100_000 + i * 16_667))
    const result = rec.stop()
    expect(result.files).toEqual([`${base}.mp4`])
    expect(result.durationMs).toBeGreaterThan(500)
    const buf = await readFile(`${base}.mp4`)
    expect(boxes(buf)).toEqual(expect.arrayContaining(['ftyp', 'mdat', 'moov']))
    expect(result.bytes).toBe(buf.length)
  })

  it('splits into a new file when the resolution changes (rotation)', async () => {
    const base = join(await mkdtemp(join(tmpdir(), 'cockpit-rec-')), 'rot')
    const rec = new ScreenRecorder(base)
    rec.push({ type: 'session', width: 1080, height: 2400 })
    rec.push(packet([...SC, ...SPS, ...SC, ...PPS], 0, { config: true }))
    rec.push(packet([...SC, ...IDR], 0, { key: true }))
    rec.push(packet([...SC, ...P], 16_667))
    rec.push({ type: 'session', width: 2400, height: 1080 })
    rec.push(packet([...SC, ...SPS, ...SC, ...PPS], 0, { config: true }))
    rec.push(packet([...SC, ...P], 40_000)) // 新分段等关键帧
    rec.push(packet([...SC, ...IDR], 50_000, { key: true }))
    rec.push(packet([...SC, ...P], 66_667))
    const { files } = rec.stop()
    expect(files).toEqual([`${base}.mp4`, `${base}_2.mp4`])
    for (const f of files) expect(boxes(await readFile(f))).toContain('moov')
  })

  it('leaves no empty file when stopped before any keyframe', async () => {
    const base = join(await mkdtemp(join(tmpdir(), 'cockpit-rec-')), 'empty')
    const rec = new ScreenRecorder(base)
    rec.push({ type: 'session', width: 1080, height: 2400 })
    rec.push(packet([...SC, ...P], 1_000))
    expect(rec.stop().files).toEqual([])
    expect(existsSync(`${base}.mp4`)).toBe(false)
  })
})
