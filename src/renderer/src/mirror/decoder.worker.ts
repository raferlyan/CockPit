/// <reference lib="webworker" />
import type { VideoCodec, VideoMessage } from '@shared/mirror'
import { h264CodecString } from './codecString'

/*
 * 解码 Worker：直接从主进程的 MessagePort 接收视频包，用 WebCodecs 硬解后画到 OffscreenCanvas。
 * 页面主线程只负责布局和输入，不经手视频数据。
 */

export type WorkerInbound = { type: 'init'; canvas: OffscreenCanvas; port: MessagePort }

export type WorkerOutbound =
  | { type: 'session'; width: number; height: number }
  | { type: 'stats'; fps: number; decodeQueue: number }
  | { type: 'error'; message: string }
  /** 解码出错后需要关键帧，页面应发送 resetVideo */
  | { type: 'needKeyframe' }
  | { type: 'end'; error?: string }

declare const self: DedicatedWorkerGlobalScope

let canvas: OffscreenCanvas
let ctx: OffscreenCanvasRenderingContext2D
let decoder: VideoDecoder | undefined
let codec: VideoCodec = 'h264'
let configuredCodec: string | undefined
let pendingConfig: Uint8Array | undefined
let waitingKeyframe = true
let frames = 0

const post = (msg: WorkerOutbound) => self.postMessage(msg)

function createDecoder(): VideoDecoder {
  return new VideoDecoder({
    output: (frame) => {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth
        canvas.height = frame.displayHeight
      }
      ctx.drawImage(frame, 0, 0)
      frame.close()
      frames++
    },
    error: (err) => {
      post({ type: 'error', message: err.message })
      // 解码器出错后进入 closed 状态，重建并等待下一个关键帧
      decoder = undefined
      configuredCodec = undefined
      waitingKeyframe = true
      post({ type: 'needKeyframe' })
    }
  })
}

function configure(config: Uint8Array): void {
  if (codec !== 'h264') {
    post({ type: 'error', message: `暂不支持 ${codec} 解码` })
    return
  }
  const codecString = h264CodecString(config)
  if (!codecString) {
    post({ type: 'error', message: '无法解析 SPS' })
    return
  }
  decoder ??= createDecoder()
  // 每个配置包都重新配置：旋转或分辨率变化时编码器会重启并下发新的 SPS
  decoder.configure({ codec: codecString, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' })
  configuredCodec = codecString
  waitingKeyframe = true
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function onVideo(msg: VideoMessage): void {
  switch (msg.type) {
    case 'codec':
      codec = msg.codec
      break
    case 'session':
      post({ type: 'session', width: msg.width, height: msg.height })
      break
    case 'packet': {
      if (msg.config) {
        pendingConfig = msg.data
        configure(msg.data)
        return
      }
      if (!decoder || !configuredCodec || decoder.state !== 'configured') {
        // 解码器出错后可能还留着上一次的 SPS
        if (pendingConfig && msg.key) configure(pendingConfig)
        else return
      }
      if (waitingKeyframe && !msg.key) return
      // H.264 Annex-B：SPS/PPS 需与关键帧拼在一起送入解码器
      const data = msg.key && pendingConfig ? concat(pendingConfig, msg.data) : msg.data
      decoder!.decode(new EncodedVideoChunk({ type: msg.key ? 'key' : 'delta', timestamp: msg.pts, data }))
      waitingKeyframe = false
      break
    }
    case 'end':
      post({ type: 'end', error: msg.error })
      decoder?.close()
      decoder = undefined
      break
  }
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  if (event.data.type !== 'init') return
  canvas = event.data.canvas
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  event.data.port.onmessage = (e: MessageEvent<VideoMessage>) => onVideo(e.data)
  event.data.port.start()

  setInterval(() => {
    post({ type: 'stats', fps: frames, decodeQueue: decoder?.decodeQueueSize ?? 0 })
    frames = 0
  }, 1000)
}
