import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import type { ControlInput, MirrorSessionInfo } from '@shared/mirror'
import type { Device } from '@shared/models'
import { api } from '../api'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { deviceTitle } from '../labels'
import { discardMirrorPort, takeMirrorPort } from './portRegistry'
import { AndroidKey, isInjectableText, metaStateOf, shouldSendAsKeycode, toAndroidKeycode } from './keyboard'
import type { WorkerInbound, WorkerOutbound } from './decoder.worker'

type ViewState = 'idle' | 'starting' | 'running' | 'error'
interface Size {
  width: number
  height: number
}

const isMac = api.platform === 'darwin'

/** 系统快捷键修饰键：macOS 用 Cmd，其他平台用 Ctrl */
function isShortcut(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

export function MirrorView({ device }: { device: Device }) {
  const [state, setState] = useState<ViewState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<MirrorSessionInfo | null>(null)
  const [videoSize, setVideoSize] = useState<Size | null>(null)
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 })
  const [fps, setFps] = useState(0)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imeRef = useRef<HTMLTextAreaElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const videoSizeRef = useRef<Size | null>(null)
  const composingRef = useRef(false)

  const send = useCallback((input: ControlInput) => {
    const id = sessionIdRef.current
    if (id) api.mirror.control(id, input)
  }, [])

  const teardown = useCallback((nextState: ViewState, message?: string) => {
    workerRef.current?.terminate()
    workerRef.current = null
    if (sessionIdRef.current) discardMirrorPort(sessionIdRef.current)
    sessionIdRef.current = null
    videoSizeRef.current = null
    setSession(null)
    setVideoSize(null)
    setFps(0)
    setState(nextState)
    setError(message ?? null)
  }, [])

  const start = useCallback(async () => {
    setState('starting')
    setError(null)
    try {
      const info = await api.mirror.start(device.serial)
      sessionIdRef.current = info.sessionId
      setSession(info)
      setState('running')
    } catch (err) {
      const message = errorMessage(err)
      notify('error', '投屏启动失败', message)
      teardown('error', message)
    }
  }, [device.serial, teardown])

  const stop = useCallback(() => {
    const id = sessionIdRef.current
    if (id) void api.mirror.stop(id)
    teardown('idle')
  }, [teardown])

  // 会话事件：设备端结束或出错
  useEffect(
    () =>
      api.mirror.onEvent((event) => {
        if (event.sessionId !== sessionIdRef.current || event.type !== 'state') return
        if (event.state === 'stopped') teardown('idle')
        if (event.state === 'error') {
          notify('error', '投屏中断', event.error)
          teardown('error', event.error)
        }
      }),
    [teardown]
  )

  // 卸载（切换设备）时结束会话
  useEffect(
    () => () => {
      const id = sessionIdRef.current
      if (id) void api.mirror.stop(id)
      workerRef.current?.terminate()
    },
    []
  )

  // canvas 挂载后把它交给解码 Worker
  useEffect(() => {
    if (!session || !canvasRef.current) return
    const canvas = canvasRef.current
    const worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data
      switch (msg.type) {
        case 'session':
          videoSizeRef.current = { width: msg.width, height: msg.height }
          setVideoSize(videoSizeRef.current)
          break
        case 'stats':
          setFps(msg.fps)
          break
        case 'needKeyframe':
          send({ type: 'resetVideo' })
          break
        case 'error':
          console.warn('[mirror] decoder:', msg.message)
          notify('warn', '画面解码出错，正在请求关键帧恢复', msg.message)
          break
        case 'end':
          break
      }
    }

    let cancelled = false
    takeMirrorPort(session.sessionId)
      .then((port) => {
        if (cancelled) return port.close()
        const offscreen = canvas.transferControlToOffscreen()
        const init: WorkerInbound = { type: 'init', canvas: offscreen, port }
        worker.postMessage(init, [offscreen, port])
        imeRef.current?.focus()
      })
      .catch((err: Error) => {
        notify('error', '投屏画面通道建立失败', err.message)
        setError(err.message)
      })

    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [session, send])

  // 舞台尺寸，用于等比缩放画面
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStageSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* ---------------- 输入 ---------------- */

  const toDevicePoint = (e: { clientX: number; clientY: number }) => {
    const size = videoSizeRef.current
    const canvas = canvasRef.current
    if (!size || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * size.width
    const y = ((e.clientY - rect.top) / rect.height) * size.height
    return {
      x: Math.min(Math.max(x, 0), size.width - 1),
      y: Math.min(Math.max(y, 0), size.height - 1),
      width: size.width,
      height: size.height
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    imeRef.current?.focus()
    e.preventDefault()
    if (e.button === 0) {
      const p = toDevicePoint(e)
      if (!p) return
      e.currentTarget.setPointerCapture(e.pointerId)
      send({ type: 'touch', action: 'down', ...p })
    } else if (e.button === 2) {
      send({ type: 'backOrScreenOn', action: 'down' })
    } else if (e.button === 1) {
      send({ type: 'key', action: 'down', keycode: AndroidKey.HOME })
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!(e.buttons & 1)) return
    const p = toDevicePoint(e)
    if (p) send({ type: 'touch', action: 'move', ...p })
  }

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      const p = toDevicePoint(e)
      if (p) send({ type: 'touch', action: 'up', ...p })
    } else if (e.button === 2) {
      send({ type: 'backOrScreenOn', action: 'up' })
    } else if (e.button === 1) {
      send({ type: 'key', action: 'up', keycode: AndroidKey.HOME })
    }
  }

  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const p = toDevicePoint(e)
    if (!p) return
    // 像素增量换算成 Android 滚动量，范围 [-16, 16]
    const scale = e.deltaMode === 1 ? 1 : 1 / 40
    send({ type: 'scroll', ...p, hscroll: -e.deltaX * scale, vscroll: -e.deltaY * scale })
  }

  const sendText = (text: string) => {
    if (!text) return
    send(isInjectableText(text) ? { type: 'text', text } : { type: 'pasteText', text })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process') return
    if (isShortcut(e)) {
      const key = e.key.toLowerCase()
      if (key === 'v') {
        e.preventDefault()
        send({ type: 'pasteFromHost' })
        return
      }
      if (key === 'c' || key === 'x') {
        e.preventDefault()
        send({ type: 'getClipboard', copyKey: key === 'c' ? 'copy' : 'cut' })
        return
      }
      // macOS 上其他 Cmd 组合键留给应用本身（如 Cmd+Q）
      if (isMac) return
    }
    if (!shouldSendAsKeycode(e)) return
    const keycode = toAndroidKeycode(e.code)
    if (keycode === undefined) return
    e.preventDefault()
    send({ type: 'key', action: 'down', keycode, repeat: e.repeat ? 1 : 0, metaState: metaStateOf(e) })
  }

  const onKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isMac && e.metaKey) return
    if (!shouldSendAsKeycode(e)) return
    const keycode = toAndroidKeycode(e.code)
    if (keycode === undefined) return
    e.preventDefault()
    send({ type: 'key', action: 'up', keycode, metaState: metaStateOf(e) })
  }

  const onInput = () => {
    const el = imeRef.current
    if (!el || composingRef.current) return
    sendText(el.value)
    el.value = ''
  }

  const onCompositionEnd = (data: string) => {
    composingRef.current = false
    sendText(data)
    if (imeRef.current) imeRef.current.value = ''
  }

  const pressKey = (keycode: number) => {
    send({ type: 'key', action: 'down', keycode })
    send({ type: 'key', action: 'up', keycode })
    imeRef.current?.focus()
  }

  // 已连上但迟迟没有第一帧：多半是设备息屏或解码不支持，提示用户而不是一直空白
  useEffect(() => {
    if (state !== 'running' || videoSize) return
    const timer = setTimeout(
      () => notify('warn', '投屏已连接，但 8 秒内没有收到画面', '设备可能处于息屏状态，可以点「电源」点亮屏幕；仍然没有画面时停止后重新投屏'),
      NO_FRAME_TIMEOUT
    )
    return () => clearTimeout(timer)
  }, [state, videoSize])

  /* ---------------- 渲染 ---------------- */

  let canvasStyle: { width: number; height: number } | undefined
  if (videoSize && stageSize.width && stageSize.height) {
    const scale = Math.min(stageSize.width / videoSize.width, stageSize.height / videoSize.height)
    canvasStyle = { width: Math.floor(videoSize.width * scale), height: Math.floor(videoSize.height * scale) }
  }

  const running = state === 'running'
  const keysDisabled = state === 'starting' ? STARTING_REASON : !running && '先点「开始投屏」，投屏后才能操作设备'

  return (
    <div className="mirror">
      <div className="mirror-toolbar">
        <span className="mirror-title">{deviceTitle(device)}</span>
        {running && videoSize && (
          <span className="mirror-meta mono">
            {videoSize.width}×{videoSize.height} · {fps} fps
          </span>
        )}
        <span className="spacer" />
        <div className="mirror-keys">
          <ToolButton label="返回" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.BACK)} />
          <ToolButton label="主页" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.HOME)} />
          <ToolButton label="多任务" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.APP_SWITCH)} />
          <ToolButton label="音量+" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.VOLUME_UP)} />
          <ToolButton label="音量-" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.VOLUME_DOWN)} />
          <ToolButton label="电源" disabledReason={keysDisabled} onClick={() => pressKey(AndroidKey.POWER)} />
          <ToolButton label="通知栏" disabledReason={keysDisabled} onClick={() => send({ type: 'expandNotificationPanel' })} />
          <ToolButton label="旋转" disabledReason={keysDisabled} onClick={() => send({ type: 'rotateDevice' })} />
        </div>
        {running || state === 'starting' ? (
          <ActionButton className="secondary" onClick={stop} disabledReason={state === 'starting' && STARTING_REASON}>
            停止
          </ActionButton>
        ) : (
          <button className="primary" onClick={() => void start()}>
            开始投屏
          </button>
        )}
      </div>

      <div className="mirror-stage" ref={stageRef}>
        {session && (
          <canvas
            key={session.sessionId}
            ref={canvasRef}
            className="mirror-canvas"
            style={canvasStyle ?? { visibility: 'hidden' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
        {state === 'starting' && <p className="mirror-hint">正在启动投屏…</p>}
        {running && !videoSize && <p className="mirror-hint">等待画面…</p>}
        {state === 'idle' && <p className="mirror-hint">点击「开始投屏」</p>}
        {state === 'error' && <p className="mirror-hint error">投屏失败：{error}</p>}
        <textarea
          ref={imeRef}
          className="mirror-ime"
          aria-label="设备键盘输入"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onInput={onInput}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={(e) => onCompositionEnd(e.data)}
        />
      </div>
    </div>
  )
}

const STARTING_REASON = '投屏正在启动，请稍候'
const NO_FRAME_TIMEOUT = 8_000

function ToolButton({ label, onClick, disabledReason }: { label: string; onClick(): void; disabledReason?: string | false }) {
  return (
    // 按下时不抢焦点，键盘输入仍留在投屏上
    <ActionButton className="tool" onClick={onClick} disabledReason={disabledReason} onMouseDown={(e) => e.preventDefault()}>
      {label}
    </ActionButton>
  )
}
