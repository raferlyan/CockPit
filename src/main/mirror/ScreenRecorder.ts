import { closeSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { Muxer, StreamTarget } from 'mp4-muxer'
import type { VideoMessage } from '@shared/mirror'

/** 最后一帧不知道时长时按 60 fps 估算 */
const FALLBACK_FRAME_US = 16_667
/** 先在内存里攒这么多再写盘，减少写入次数 */
const WRITE_CHUNK = 4 * 1024 * 1024

const NAL_SPS = 7
const NAL_PPS = 8
const NAL_AUD = 9

/** 把 Annex-B 码流（00 00 01 / 00 00 00 01 分隔）拆成 NAL 单元，不含起始码 */
export function splitAnnexB(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = []
  let start = -1
  let i = 0
  while (i + 2 < data.length) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) {
        // 前一个 NAL 末尾的 0x00 属于 4 字节起始码，去掉
        let end = i
        while (end > start && data[end - 1] === 0) end--
        nals.push(data.subarray(start, end))
      }
      i += 3
      start = i
    } else i++
  }
  if (start >= 0 && start < data.length) nals.push(data.subarray(start))
  return nals.filter((n) => n.length > 0)
}

/** 由 SPS / PPS 构造 MP4 的 avcC（AVCDecoderConfigurationRecord） */
export function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length)
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff])
  out.set(sps, 8)
  const p = 8 + sps.length
  out.set([1, pps.length >> 8, pps.length & 0xff], p)
  out.set(pps, p + 3)
  return out
}

/** avc1.PPCCLL：profile、约束、level，取自 SPS */
export function avcCodecString(sps: Uint8Array): string {
  return `avc1.${[sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** 帧数据转成 MP4 需要的「4 字节长度 + NAL」，去掉参数集和分隔符（已经写在 avcC 里） */
export function toLengthPrefixed(nals: Uint8Array[]): Uint8Array {
  const kept = nals.filter((n) => ![NAL_SPS, NAL_PPS, NAL_AUD].includes(n[0] & 0x1f))
  const out = new Uint8Array(kept.reduce((sum, n) => sum + 4 + n.length, 0))
  let offset = 0
  for (const n of kept) {
    new DataView(out.buffer).setUint32(offset, n.length)
    out.set(n, offset + 4)
    offset += 4 + n.length
  }
  return out
}

export interface RecordingResult {
  files: string[]
  durationMs: number
  bytes: number
}

interface Segment {
  path: string
  fd: number
  muxer: Muxer<StreamTarget>
  firstPts: number
  lastTs: number
  /** 等下一帧到达才知道时长，先存着 */
  pending?: { data: Uint8Array; key: boolean; ts: number }
  frames: number
  configSent: boolean
}

/**
 * 把投屏收到的 H.264 码流直接封装成 MP4，不重新编码：画质与投屏一致，几乎不占 CPU，
 * 也没有设备端 screenrecord 的 3 分钟限制。边录边写盘，内存占用固定。
 *
 * 从下一个关键帧开始录；设备旋转导致分辨率变化时结束当前文件，从下一个关键帧开始写新的分段
 * （同一个 MP4 轨道不能中途改分辨率）。
 */
export class ScreenRecorder {
  private segment?: Segment
  private readonly files: string[] = []
  private sps?: Uint8Array
  private pps?: Uint8Array
  private width = 0
  private height = 0
  private totalUs = 0
  private stopped = false

  /** basePath 不含扩展名；第二段起加 _2、_3 */
  constructor(private readonly basePath: string) {}

  push(message: VideoMessage): void {
    if (this.stopped) return
    if (message.type === 'session') {
      const changed = message.width !== this.width || message.height !== this.height
      this.width = message.width
      this.height = message.height
      if (changed && this.segment) this.finishSegment()
      return
    }
    if (message.type !== 'packet') return
    const nals = splitAnnexB(message.data)
    if (message.config) {
      for (const n of nals) {
        const type = n[0] & 0x1f
        if (type === NAL_SPS) this.sps = n.slice()
        if (type === NAL_PPS) this.pps = n.slice()
      }
      return
    }
    // 关键帧里也可能带着参数集
    for (const n of nals) {
      const type = n[0] & 0x1f
      if (type === NAL_SPS) this.sps = n.slice()
      if (type === NAL_PPS) this.pps = n.slice()
    }
    if (!this.segment) {
      if (!message.key || !this.sps || !this.pps || !this.width || !this.height) return
      this.segment = this.openSegment(message.pts)
    }
    this.addFrame(this.segment, toLengthPrefixed(nals), message.key, message.pts)
  }

  /** 已经写入了画面（等到了第一个关键帧） */
  get started(): boolean {
    return this.files.length > 0 || Boolean(this.segment?.frames || this.segment?.pending)
  }

  stop(): RecordingResult {
    if (!this.stopped) {
      this.stopped = true
      this.finishSegment()
    }
    const bytes = this.files.reduce((sum, f) => sum + (statSafe(f) ?? 0), 0)
    return { files: [...this.files], durationMs: Math.round(this.totalUs / 1000), bytes }
  }

  private openSegment(pts: number): Segment {
    const path = this.files.length ? `${this.basePath}_${this.files.length + 1}.mp4` : `${this.basePath}.mp4`
    const fd = openSync(path, 'w')
    const target = new StreamTarget({
      onData: (data, position) => {
        writeSync(fd, data, 0, data.length, position)
      },
      chunked: true,
      chunkSize: WRITE_CHUNK
    })
    // fastStart: false 把索引写在文件末尾，录多久内存都不涨
    const muxer = new Muxer({ target, video: { codec: 'avc', width: this.width, height: this.height }, fastStart: false })
    this.files.push(path)
    return { path, fd, muxer, firstPts: pts, lastTs: -1, frames: 0, configSent: false }
  }

  private addFrame(segment: Segment, data: Uint8Array, key: boolean, pts: number): void {
    // 时间戳必须递增；设备偶尔给出相同或回退的 pts 时顺延 1 微秒
    let ts = Math.max(0, pts - segment.firstPts)
    if (ts <= segment.lastTs) ts = segment.lastTs + 1
    segment.lastTs = ts
    if (segment.pending) this.writePending(segment, ts - segment.pending.ts)
    segment.pending = { data, key, ts }
  }

  private writePending(segment: Segment, duration: number): void {
    const frame = segment.pending!
    segment.pending = undefined
    const meta = segment.configSent
      ? undefined
      : {
          decoderConfig: {
            codec: avcCodecString(this.sps!),
            codedWidth: this.width,
            codedHeight: this.height,
            description: buildAvcC(this.sps!, this.pps!)
          }
        }
    segment.muxer.addVideoChunkRaw(frame.data, frame.key ? 'key' : 'delta', frame.ts, Math.max(1, duration), meta)
    segment.configSent = true
    segment.frames++
    this.totalUs += Math.max(1, duration)
  }

  private finishSegment(): void {
    const segment = this.segment
    if (!segment) return
    this.segment = undefined
    try {
      if (segment.pending) this.writePending(segment, FALLBACK_FRAME_US)
      if (segment.frames > 0) segment.muxer.finalize()
    } finally {
      closeSync(segment.fd)
    }
    // 一帧都没写进去的分段是无法播放的空文件，删掉
    if (segment.frames === 0) {
      this.files.splice(this.files.indexOf(segment.path), 1)
      try {
        unlinkSync(segment.path)
      } catch {
        // 已经不存在
      }
    }
  }
}

function statSafe(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}
