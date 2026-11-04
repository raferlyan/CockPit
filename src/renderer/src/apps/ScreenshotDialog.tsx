import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { api } from '../api'
import { errorMessage, notify } from '../notify/notifyStore'
import { t } from '../i18n'
import { useScreenshotStore, type Shot } from './screenshot'

type Tool = 'pen' | 'rect' | 'arrow' | 'text' | 'mosaic'

interface Point {
  x: number
  y: number
}

/** 一笔标注；坐标都是原图像素 */
type Mark =
  | { tool: 'pen'; color: string; width: number; points: Point[] }
  | { tool: 'rect' | 'arrow' | 'mosaic'; color: string; width: number; from: Point; to: Point }
  | { tool: 'text'; color: string; width: number; at: Point; text: string }

const COLORS = ['#f85149', '#d29922', '#3fb950', '#4c9aff', '#ffffff', '#1b1f24']
/** 线宽按原图短边的比例换算，高分屏截图上也看得清 */
const WIDTHS = [0.003, 0.006, 0.012]

const TOOLS: Array<{ key: Tool; label: () => string; icon: string }> = [
  { key: 'pen', label: () => t('画笔'), icon: '✎' },
  { key: 'rect', label: () => t('矩形'), icon: '▭' },
  { key: 'arrow', label: () => t('箭头'), icon: '↗' },
  { key: 'text', label: () => t('文字'), icon: 'T' },
  { key: 'mosaic', label: () => t('马赛克'), icon: '▦' }
]

function loadImage(png: Uint8Array): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = url
  })
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const head = Math.max(width * 4, 12)
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x - Math.cos(angle) * head * 0.8, to.y - Math.sin(angle) * head * 0.8)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

/** 把区域缩小再放大，得到马赛克 */
function drawMosaic(ctx: CanvasRenderingContext2D, image: HTMLImageElement, from: Point, to: Point): void {
  const x = Math.round(Math.min(from.x, to.x))
  const y = Math.round(Math.min(from.y, to.y))
  const w = Math.round(Math.abs(to.x - from.x))
  const h = Math.round(Math.abs(to.y - from.y))
  if (w < 2 || h < 2) return
  const block = Math.max(8, Math.round(Math.min(image.naturalWidth, image.naturalHeight) / 60))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.ceil(w / block))
  small.height = Math.max(1, Math.ceil(h / block))
  small.getContext('2d')!.drawImage(image, x, y, w, h, 0, 0, small.width, small.height)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
  ctx.restore()
}

function render(canvas: HTMLCanvasElement, image: HTMLImageElement, marks: Mark[]): void {
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const mark of marks) {
    ctx.strokeStyle = mark.color
    ctx.fillStyle = mark.color
    ctx.lineWidth = mark.width
    switch (mark.tool) {
      case 'pen':
        ctx.beginPath()
        mark.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
        break
      case 'rect':
        ctx.strokeRect(mark.from.x, mark.from.y, mark.to.x - mark.from.x, mark.to.y - mark.from.y)
        break
      case 'arrow':
        drawArrow(ctx, mark.from, mark.to, mark.width)
        break
      case 'mosaic':
        drawMosaic(ctx, image, mark.from, mark.to)
        break
      case 'text': {
        const size = mark.width * 8
        ctx.font = `600 ${size}px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
        ctx.textBaseline = 'top'
        // 加一圈描边，任何底色上都看得清
        ctx.lineWidth = Math.max(2, size / 8)
        ctx.strokeStyle = mark.color === '#ffffff' ? '#000000aa' : '#ffffffcc'
        mark.text.split('\n').forEach((line, i) => {
          ctx.strokeText(line, mark.at.x, mark.at.y + i * size * 1.25)
          ctx.fillText(line, mark.at.x, mark.at.y + i * size * 1.25)
        })
        break
      }
    }
  }
}

/**
 * 截图预览：可以直接保存、另存为，或先用画笔、箭头、马赛克等标注后再保存。
 * 保存后停留在对话框里显示完整路径，用户看清、复制或打开目录后再关闭。
 */
export function ScreenshotDialog({ shot }: { shot: Shot }) {
  const close = useScreenshotStore((s) => s.close)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState(COLORS[0])
  const [widthIndex, setWidthIndex] = useState(1)
  const [marks, setMarks] = useState<Mark[]>([])
  const drawing = useRef<Mark | null>(null)
  const [textInput, setTextInput] = useState<{ at: Point; left: number; top: number; value: string } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let url = ''
    let cancelled = false
    void loadImage(shot.png).then(
      (loaded) => {
        url = loaded.url
        if (cancelled) URL.revokeObjectURL(url)
        else setImage(loaded.image)
      },
      (error) => notify('error', t('截图失败'), errorMessage(error))
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [shot])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    render(canvas, image, marks)
  }, [image])

  useEffect(() => {
    if (canvasRef.current && image) render(canvasRef.current, image, marks)
  }, [marks])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textInput) return
      if (e.key === 'Escape') close()
      if (editing && (e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        setMarks((m) => m.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, textInput, close])

  const lineWidth = image ? Math.max(2, Math.round(Math.min(image.naturalWidth, image.naturalHeight) * WIDTHS[widthIndex])) : 4

  const toImage = (e: ReactPointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scale = canvasRef.current!.width / rect.width
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
  }

  const redraw = (pending: Mark) => {
    if (canvasRef.current && image) render(canvasRef.current, image, [...marks, pending])
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editing || e.button !== 0) return
    const p = toImage(e)
    if (tool === 'text') {
      const host = e.currentTarget.parentElement!.getBoundingClientRect()
      setTextInput({ at: p, left: e.clientX - host.left, top: e.clientY - host.top, value: '' })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = tool === 'pen' ? { tool, color, width: lineWidth, points: [p] } : { tool, color, width: lineWidth, from: p, to: p }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const mark = drawing.current
    if (!mark) return
    const p = toImage(e)
    if (mark.tool === 'pen') mark.points.push(p)
    else if (mark.tool !== 'text') mark.to = p
    redraw(mark)
  }

  const onPointerUp = () => {
    const mark = drawing.current
    drawing.current = null
    if (!mark) return
    // 点一下没拖动的形状不算
    if (mark.tool !== 'pen' && mark.tool !== 'text' && Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) < 3) {
      if (canvasRef.current && image) render(canvasRef.current, image, marks)
      return
    }
    setMarks((m) => [...m, mark])
  }

  const commitText = () => {
    if (textInput?.value.trim()) setMarks((m) => [...m, { tool: 'text', color, width: lineWidth, at: textInput.at, text: textInput.value }])
    setTextInput(null)
  }

  /** 有标注时导出画布，否则直接用原图，避免无谓的重新编码 */
  const exportPng = async (): Promise<Uint8Array> => {
    if (!marks.length || !canvasRef.current) return shot.png
    const blob = await new Promise<Blob | null>((resolve) => canvasRef.current!.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('导出图片失败')
    return new Uint8Array(await blob.arrayBuffer())
  }

  const save = async (saveAs: boolean) => {
    setBusy(true)
    try {
      const file = await api.device.saveImage(await exportPng(), shot.label, saveAs)
      if (file) {
        setSaved(file)
        setEditing(false)
      }
    } catch (error) {
      notify('error', t('保存截图失败'), errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !editing && close()}>
      <div className="dialog screenshot-dialog" role="dialog" aria-label={t('截图')}>
        <div className="panel-title-row">
          <h2 className="panel-title">
            {t('截图')} · {shot.label}
            {image && <span className="muted screenshot-size">{`${image.naturalWidth}×${image.naturalHeight}`}</span>}
          </h2>
          <button className="tool" title={t('关闭')} onClick={close}>
            ×
          </button>
        </div>

        {editing && (
          <div className="shot-toolbar">
            <div className="segmented">
              {TOOLS.map((item) => (
                <button key={item.key} className={tool === item.key ? 'on' : ''} title={item.label()} onClick={() => setTool(item.key)}>
                  <span className="shot-tool-icon">{item.icon}</span> {item.label()}
                </button>
              ))}
            </div>
            <div className="shot-colors">
              {COLORS.map((c) => (
                <button key={c} className={`shot-color${c === color ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
              ))}
            </div>
            <div className="segmented">
              {WIDTHS.map((_, i) => (
                <button key={i} className={i === widthIndex ? 'on' : ''} title={t('粗细')} onClick={() => setWidthIndex(i)}>
                  <span className="shot-width" style={{ height: 2 + i * 2 }} />
                </button>
              ))}
            </div>
            <span className="spacer" />
            <button className="tool" disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))} title={api.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z'}>
              {t('撤销')}
            </button>
            <button className="tool" disabled={!marks.length} onClick={() => setMarks([])}>
              {t('清除标注')}
            </button>
          </div>
        )}

        <div className="shot-stage">
          <canvas
            ref={canvasRef}
            className={`shot-canvas${editing ? ` editing tool-${tool}` : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {!image && <p className="muted">{t('读取中…')}</p>}
          {textInput && (
            <input
              autoFocus
              className="shot-text-input"
              style={{ left: textInput.left, top: textInput.top, color }}
              value={textInput.value}
              placeholder={t('输入文字，回车确定')}
              onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText()
                if (e.key === 'Escape') setTextInput(null)
              }}
              onBlur={commitText}
            />
          )}
        </div>

        {saved && (
          <div className="shot-saved">
            <span className="ok">✓ {t('已保存并复制到剪贴板')}</span>
            <code className="mono shot-path" title={saved}>
              {saved}
            </code>
            <button className="tool" onClick={() => api.clipboard.writeText(saved)}>
              {t('复制路径')}
            </button>
            <button className="tool" onClick={() => api.files.reveal(saved)}>
              {t('打开所在目录')}
            </button>
          </div>
        )}

        <div className="dialog-actions">
          {!editing ? (
            <button className="secondary" disabled={!image} onClick={() => setEditing(true)}>
              {t('编辑标注')}
            </button>
          ) : (
            <button className="secondary" onClick={() => setEditing(false)}>
              {t('完成编辑')}
            </button>
          )}
          <span className="spacer" />
          <button className="secondary" onClick={close}>
            {saved ? t('完成') : t('放弃')}
          </button>
          <button className="secondary" disabled={busy || !image} onClick={() => void save(true)}>
            {t('另存为…')}
          </button>
          <button className="primary" disabled={busy || !image} onClick={() => void save(false)}>
            {saved ? t('再保存一份') : t('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}
