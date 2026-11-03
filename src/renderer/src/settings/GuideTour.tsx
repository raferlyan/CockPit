import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from './uiStore'
import { useSettingsStore, type CollapsedPanes } from './settingsStore'
import { HIDE_ALL_SHORTCUT, paneShortcut } from './ToolStripe'

const isMac = window.cockpit.platform === 'darwin'

interface TourStep {
  /** 目标元素的 data-tour 值；没有或找不到时卡片居中显示 */
  target?: string
  /** 目标不在界面上时改为高亮这个元素，并在说明后追加 missing */
  fallback?: string
  missing?: string
  title: string
  body: string
  /** 进入这一步前需要打开 Perfetto 查看器 */
  trace?: boolean
}

const STEPS: TourStep[] = [
  {
    title: '欢迎使用 Cockpit',
    body: '投屏、终端、文件传输、应用管理、状态监控和 Perfetto trace 分析都在这一个窗口里。接下来逐个指给你看，随时可以按 Esc 跳过，之后在「设置」里能再次打开。'
  },
  {
    target: 'device-list',
    title: '设备列表',
    body: '在手机「开发者选项」中打开「USB 调试」，用数据线连上电脑并在手机上允许调试授权，设备就会出现在这里。点击选中一台设备，右侧和中间区域都会切换到它。'
  },
  {
    target: 'connect',
    title: '无线连接',
    body: '手机开启无线调试后，在这里输入 IP:端口 连接，之后和 USB 设备一样使用。'
  },
  {
    target: 'device-detail',
    title: '设备信息',
    body: '型号、Android 版本、ABI、分辨率等信息固定显示在右上方。把 APK 拖到这里直接安装，其它文件会打开「文件传输」。'
  },
  {
    target: 'btn-mirror',
    fallback: 'device-detail',
    missing: '选中一台在线设备后，这里会出现「投屏」按钮。',
    title: '投屏与操控',
    body: '画面会出现在中间区域，可以直接用鼠标点按、滚轮滑动、键盘输入（支持中文）。右键是返回，中键是主页，最多 4 台设备同时投屏。'
  },
  {
    target: 'btn-transfer',
    fallback: 'device-detail',
    missing: '选中一台在线设备后，这里会出现「文件传输」按钮。',
    title: '文件传输',
    body: '左边选本机文件，右边选设备目录后上传；设备上的文件也能直接下载到电脑。已 root 的设备访问受保护目录时会自动通过 su 中转。'
  },
  {
    target: 'btn-apps',
    fallback: 'device-detail',
    missing: '选中一台在线设备后，这里会出现「应用管理」按钮。',
    title: '应用管理',
    body: '扫描设备上的全部应用，按用户 / 系统 / 已停用分类搜索，批量卸载、停用、清除数据、导出 APK，误卸载的系统应用也能恢复。'
  },
  {
    target: 'btn-screenshot',
    fallback: 'device-detail',
    missing: '选中一台在线设备后，这里会出现「截图」按钮。',
    title: '截图',
    body: '按设备原始分辨率截图，保存到「图片/Cockpit」，同时复制到剪贴板，可以直接粘贴到聊天或文档里。'
  },
  {
    target: 'btn-trace',
    fallback: 'device-detail',
    missing: '选中一台在线设备后，这里会出现「录制 Trace」按钮。',
    title: '录制 Trace',
    body: '用手机自带的 perfetto 录制系统 trace，提供卡顿、应用启动（自动冷启动）、内存、功耗四个预设。录完自动保存到「文稿/Cockpit/Traces」，并在内嵌的 Perfetto 里打开，直接缩放到录制的那一段。'
  },
  {
    target: 'status',
    title: '设备状态',
    body: 'CPU、内存、温度、电池、网络、进程 Top 10 和存储每秒刷新，带 5 分钟曲线。连了多台设备时可以切到「对比」，把它们画在同一张图上。'
  },
  {
    target: 'terminal-actions',
    title: '终端',
    body: '底部可以开多个 adb Shell、Logcat 和串口标签。输入时会提示命令、选项、设备上的包名和历史命令；把文件拖进终端会插入它的路径。'
  },
  {
    target: 'perfetto',
    title: 'Perfetto 查看器',
    body: '点这里在中间区域打开内嵌的 Perfetto，它随应用一起打包，完全离线运行，trace 不会上传到任何地方。下面打开它看看。'
  },
  {
    target: 'trace-view',
    trace: true,
    title: '分析 trace',
    body: '这里就是完整的 Perfetto 界面：时间线上看 CPU 调度、线程状态、帧时间线，左侧菜单里还有 SQL 查询和指标。点工具栏的「收起」会关闭它并释放内存。'
  },
  {
    target: 'trace-list',
    trace: true,
    title: 'Trace 列表',
    body: '录过的 trace 都在这里，可以重新打开、在 Finder 中显示或移到废纸篓。'
  },
  {
    target: 'trace-open',
    trace: true,
    title: '打开本机 trace',
    body: '也可以打开电脑上已有的 .pftrace、.perfetto-trace、systrace 或 JSON trace，比如同事发来的文件。'
  },
  {
    target: 'collapse-sidebar',
    title: '收起区域',
    body: `设备列表、设备信息和终端的标题栏右边都有这样的箭头，点一下收起成贴边的图标条，点图标条再展开。快捷键 ${paneShortcut('sidebar')} / ${paneShortcut('side')} / ${paneShortcut('terminal')}，${HIDE_ALL_SHORTCUT} 一键收起或展开全部。区域之间的边框可以拖动调整大小。`
  },
  {
    target: 'theme',
    title: '主题',
    body: '白天、黑夜，或者跟随系统自动切换。'
  },
  {
    target: 'settings',
    title: '设置',
    body: `调整整体字号、界面和终端字体、恢复默认布局，也能在这里重新打开本向导。${isMac ? '⌘' : 'Ctrl'} + = / − / 0 可以快速缩放界面。`
  }
]

/** 高亮框比目标元素四周多出的距离 */
const PAD = 6
const RADIUS = 8
/** 卡片与高亮框、窗口边缘的间距 */
const GAP = 14
const MARGIN = 12
/** 换目标时高亮区域移动的时长 */
const TWEEN_MS = 250

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 找到第一个真正显示在界面上的目标（同一个 data-tour 可能有隐藏的副本） */
function findTarget(name: string | undefined): HTMLElement | null {
  if (!name) return null
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  // 高亮框不超出窗口，贴边的元素（如状态栏）也能看到完整的描边
  const x = Math.max(r.left - PAD, 2)
  const y = Math.max(r.top - PAD, 2)
  return { x, y, w: Math.min(r.right + PAD, window.innerWidth - 2) - x, h: Math.min(r.bottom + PAD, window.innerHeight - 2) - y }
}

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

/**
 * 挖掉高亮区域的遮罩。CSS mask 按透明度裁剪，所以用 evenodd 路径画「整屏减去圆角矩形」：
 * 有填充处显示压暗和模糊，洞里透出原界面
 */
function maskOf(box: Box | null): string | undefined {
  if (!box) return undefined
  const { innerWidth: w, innerHeight: h } = window
  const { x, y, w: bw, h: bh } = box
  const r = Math.min(RADIUS, bw / 2, bh / 2)
  const hole =
    `M${x + r} ${y}H${x + bw - r}A${r} ${r} 0 0 1 ${x + bw} ${y + r}V${y + bh - r}A${r} ${r} 0 0 1 ${x + bw - r} ${y + bh}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + bh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<path fill="#000" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z${hole}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

type Side = 'right' | 'left' | 'bottom' | 'top'

/** 卡片放在高亮框外空间最大的一侧，并限制在窗口内；箭头始终指向高亮框中心 */
function placeCard(box: Box, card: { w: number; h: number }): { left: number; top: number; side: Side; arrow: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const space: Record<Side, number> = {
    right: vw - (box.x + box.w) - GAP - MARGIN - card.w,
    left: box.x - GAP - MARGIN - card.w,
    bottom: vh - (box.y + box.h) - GAP - MARGIN - card.h,
    top: box.y - GAP - MARGIN - card.h
  }
  const side = (['right', 'left', 'bottom', 'top'] as Side[]).reduce((best, s) => (space[s] > space[best] ? s : best), 'right')
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (side === 'right' || side === 'left') {
    const left = side === 'right' ? box.x + box.w + GAP : box.x - GAP - card.w
    const top = clamp(cy - card.h / 2, MARGIN, vh - MARGIN - card.h)
    return { left, top, side, arrow: clamp(cy - top, 16, card.h - 16) }
  }
  const top = side === 'bottom' ? box.y + box.h + GAP : box.y - GAP - card.h
  const left = clamp(cx - card.w / 2, MARGIN, vw - MARGIN - card.w)
  return { left, top, side, arrow: clamp(cx - left, 16, card.w - 16) }
}

/**
 * 聚光灯式使用向导：其余界面压暗并模糊，只把当前讲解的按钮或区域框出来，旁边的卡片说明它的作用。
 * 开始时展开所有收起的区域，讲到 Perfetto 时打开查看器，结束后恢复原样。
 */
export function GuideTour() {
  const finishGuide = useUiStore((s) => s.finishGuide)
  const deviceCount = useAppStore((s) => s.devices.filter((d) => d.state === 'device').length)
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [usingFallback, setUsingFallback] = useState(false)
  const [cardSize, setCardSize] = useState({ w: 340, h: 180 })
  const cardRef = useRef<HTMLDivElement>(null)
  const step = STEPS[index]
  const last = index === STEPS.length - 1

  // 记下进入向导前的布局，结束时恢复
  const saved = useRef<{ collapsed: CollapsedPanes; traceOpen: boolean } | null>(null)
  useEffect(() => {
    const settings = useSettingsStore.getState()
    saved.current = { collapsed: settings.collapsed, traceOpen: useUiStore.getState().traceOpen }
    settings.update({ collapsed: { sidebar: false, side: false, terminal: false } })
    return () => {
      if (!saved.current) return
      useSettingsStore.getState().update({ collapsed: saved.current.collapsed })
      useUiStore.getState().setTraceOpen(saved.current.traceOpen)
    }
  }, [])

  useEffect(() => {
    useUiStore.getState().setTraceOpen(Boolean(step.trace) || (saved.current?.traceOpen ?? false))
  }, [step.trace])

  // 目标位置会随布局变化（区域展开、Perfetto 加载、窗口缩放），每帧检查一次，变了才更新
  useEffect(() => {
    let frame = 0
    let scrolled = false
    const tick = () => {
      const primary = findTarget(step.target)
      const el = primary ?? findTarget(step.fallback)
      if (el && !scrolled) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        scrolled = true
      }
      const next = el ? boxOf(el) : null
      setBox((prev) => (sameBox(prev, next) ? prev : next))
      setUsingFallback(!primary && Boolean(el))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [step.target, step.fallback])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const next = { w: card.offsetWidth, h: card.offsetHeight }
    setCardSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
  })

  const next = () => (last ? finishGuide() : setIndex(index + 1))
  const prev = () => setIndex(Math.max(index - 1, 0))

  // 捕获阶段处理并拦下，避免按键落到终端或下面的界面上
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishGuide()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') prev()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const shown = useTweenedBox(box)
  const placement = shown ? placeCard(shown, cardSize) : null
  const cardStyle: CSSProperties = placement
    ? { left: placement.left, top: placement.top, ['--arrow' as string]: `${placement.arrow}px` }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  const mask = maskOf(shown)

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="使用向导">
      <div className="tour-shade" style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined} />
      {shown && <div className="tour-ring" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} />}
      <div ref={cardRef} className={`tour-card${placement ? ` side-${placement.side}` : ''}`} style={cardStyle}>
        <div className="tour-step mono">
          {index + 1} / {STEPS.length}
        </div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-text">{step.body}</p>
        {usingFallback && step.missing && <p className="tour-text tour-note">{step.missing}</p>}
        {step.target === 'device-list' && (
          <p className={`tour-status${deviceCount ? ' ok' : ''}`}>
            {deviceCount ? `✓ 已检测到 ${deviceCount} 台在线设备` : '尚未检测到在线设备，连接后这里会自动更新'}
          </p>
        )}
        <div className="tour-actions">
          {!last && (
            <button className="link" onClick={finishGuide}>
              跳过
            </button>
          )}
          <span className="spacer" />
          {index > 0 && (
            <button className="secondary" onClick={prev}>
              上一步
            </button>
          )}
          <button className="primary" onClick={next}>
            {last ? '开始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 高亮区域换目标时逐帧插值过去。遮罩的洞没法用 CSS 过渡，统一在这里动画，
 * 洞、描边和卡片才能同步移动
 */
function useTweenedBox(target: Box | null): Box | null {
  const [shown, setShown] = useState<Box | null>(target)
  const current = useRef<Box | null>(target)

  useEffect(() => {
    const from = current.current
    if (!target || !from) {
      current.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / TWEEN_MS, 1)
      const e = 1 - (1 - t) ** 3
      const mix = (a: number, b: number) => a + (b - a) * e
      const box = { x: mix(from.x, target.x), y: mix(from.y, target.y), w: mix(from.w, target.w), h: mix(from.h, target.h) }
      current.current = box
      setShown(box)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return shown
}
