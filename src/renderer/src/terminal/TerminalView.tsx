import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import '@fontsource/cascadia-mono/400.css'
import '@fontsource/cascadia-mono/700.css'
import { api } from '../api'
import { Exit } from '../motion/Exit'
import { droppedPaths, hasDraggedFiles } from '../files/fileStore'
import { listenTerminal, type TerminalTab } from './terminalStore'
import { compileFilter, DEFAULT_FILTER, logcatBuffer, renderLine, type CompiledFilter } from './logcat'
import { t } from '../i18n'
import { suggest, type Suggestion } from './completion'
import { getHistory, getPackages, recordHistory } from './completionSources'
import { HistoryNav, type LineEdit } from './historyNav'
import { readInputLine } from './inputLine'
import { useThemeStore, type ResolvedTheme } from '../theme/themeStore'
import { terminalFontStack, useSettingsStore } from '../settings/settingsStore'

const isMac = api.platform === 'darwin'

/** 背景与 styles.css 的 --bg 一致；白天主题把 ANSI 里的白、黄调深，logcat 的 V/W 级别在白底上才看得清 */
const THEMES: Record<ResolvedTheme, ITheme> = {
  dark: {
    background: '#14161a',
    foreground: '#e3e6eb',
    cursor: '#e3e6eb',
    selectionBackground: '#4c9aff55'
  },
  light: {
    background: '#f5f6f8',
    foreground: '#1b1f24',
    cursor: '#1b1f24',
    selectionBackground: '#1f6feb33',
    black: '#1b1f24',
    white: '#5f6773',
    brightWhite: '#1b1f24',
    yellow: '#9a6700',
    brightYellow: '#7d5300',
    green: '#1a7f37',
    brightGreen: '#116329',
    cyan: '#0e7490',
    brightCyan: '#0b5e74'
  }
}

/** 用户敲键后这么久内收到的回显才触发提示，避免命令输出刷屏时弹出提示框 */
const TYPING_WINDOW = 800

const KIND_LABEL = (): Record<Suggestion['kind'], string> => ({ history: t('历史'), command: t('命令'), option: t('选项'), package: t('包名'), value: t('参数') })

interface Popup {
  items: Suggestion[]
  index: number
  /** 相对终端区域左上角的像素位置（光标下一行） */
  x: number
  y: number
  /** 光标行的高度，向上弹出时使用 */
  lineHeight: number
}

/** 拖进终端的路径带空格等特殊字符时加单引号 */
function quotePath(path: string, powershell = false): string {
  if (/^[\w@%+=:,./\\-]+$/.test(path)) return path
  // PowerShell 的单引号字符串里用两个单引号表示一个
  return powershell ? `'${path.replace(/'/g, "''")}'` : `'${path.replace(/'/g, `'\\''`)}'`
}

/**
 * 一个标签对应一个 xterm 实例。隐藏的标签保持挂载（display:none），
 * 切回来时不丢滚动缓冲；重新可见时按容器尺寸重新 fit。
 */
export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ term: Terminal; fit: () => void } | null>(null)
  /** logcat 当前的筛选与暂停状态，数据回调里读取 */
  const viewRef = useRef<{ filter: CompiledFilter; paused: boolean }>({ filter: compileFilter(DEFAULT_FILTER), paused: false })
  const [popup, setPopup] = useState<Popup | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  const interactive = tab.kind !== 'logcat'
  const resolvedTheme = useThemeStore((s) => s.resolved)
  const monoFont = useSettingsStore((s) => s.monoFont)
  const terminalFont = useSettingsStore((s) => s.terminalFont)
  const fontSize = useSettingsStore((s) => s.terminalFontSize)

  const showPopup = (next: Popup | null) => {
    popupRef.current = next
    setPopup(next)
  }

  const copySelection = () => {
    const term = termRef.current?.term
    if (!term?.hasSelection()) return false
    api.clipboard.writeText(term.getSelection())
    return true
  }

  const paste = () => {
    const term = termRef.current?.term
    if (!term || !interactive) return
    void api.clipboard.readText().then((text) => text && term.paste(text))
  }

  const accept = (item: Suggestion) => {
    api.terminal.write(tab.id, '\x7f'.repeat(item.deleteCount) + item.insert)
    showPopup(null)
  }

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontFamily: terminalFontStack(useSettingsStore.getState().terminalFont, useSettingsStore.getState().monoFont),
      fontSize: useSettingsStore.getState().terminalFontSize,
      theme: THEMES[useThemeStore.getState().resolved],
      cursorBlink: tab.kind === 'shell' || tab.kind === 'local',
      disableStdin: tab.kind === 'logcat',
      // 每行约占 列数×12 字节，120 列时 1 万行约 14 MB；logcat 刷屏快多留一些，shell 够翻看最近输出即可
      scrollback: tab.kind === 'logcat' ? 10_000 : 3_000,
      macOptionIsMeta: true,
      // Windows 上右键默认会选中单词，这里统一弹出自己的右键菜单
      rightClickSelectsWord: false
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(host)

    let lastSize = ''
    const fit = () => {
      // 隐藏时容器尺寸为 0，fit 会算出无效的行列数
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      fitAddon.fit()
      const size = `${term.cols}x${term.rows}`
      if (size !== lastSize) {
        lastSize = size
        api.terminal.resize(tab.id, term.cols, term.rows)
      }
    }
    termRef.current = { term, fit }

    /* ---------- 智能提示 ---------- */

    let typedAt = 0
    let frame = 0
    const updateSuggestions = () => {
      frame = 0
      const line = readInputLine(term)
      // 补全规则是给设备 shell 的，本机终端不提示
      const items = line === null || tab.kind === 'local' ? [] : suggest(line, { history: getHistory(), packages: tab.serial ? getPackages(tab.serial) : [] })
      if (!items.length) return showPopup(null)
      const screen = term.element?.querySelector('.xterm-screen')
      if (!screen) return
      const cellWidth = screen.clientWidth / term.cols
      const cellHeight = screen.clientHeight / term.rows
      const buffer = term.buffer.active
      showPopup({
        items,
        index: 0,
        x: buffer.cursorX * cellWidth,
        y: (buffer.cursorY + 1) * cellHeight,
        lineHeight: cellHeight
      })
    }
    const scheduleUpdate = () => {
      if (Date.now() - typedAt > TYPING_WINDOW) return
      frame ||= requestAnimationFrame(updateSuggestions)
    }

    const historyNav = new HistoryNav(getHistory)
    /** 上下键：在提示符后翻历史。全屏程序、前台命令没有提示符，按键照常交给设备；PowerShell 有自己的历史 */
    const navigateHistory = (key: 'ArrowUp' | 'ArrowDown'): boolean => {
      if (tab.kind === 'local' || tab.kind === 'logcat') return false
      let edit: LineEdit | null
      if (historyNav.active) {
        edit = key === 'ArrowUp' ? historyNav.up('') : historyNav.down()
      } else {
        const line = readInputLine(term)
        if (line === null) return false
        edit = key === 'ArrowUp' ? historyNav.up(line) : null
        if (!edit && key === 'ArrowUp') return false
      }
      if (edit) api.terminal.write(tab.id, '\x7f'.repeat(edit.deleteCount) + edit.insert)
      typedAt = 0
      return true
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const shortcut = isMac ? event.metaKey : event.ctrlKey && event.shiftKey
      const plainCtrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey

      // 复制：macOS Cmd+C；Windows Ctrl+Shift+C；两个平台有选中内容时的 Ctrl+C 也是复制（没有选中时仍是中断）
      if (event.code === 'KeyC' && (shortcut || (plainCtrl && term.hasSelection()))) {
        if (copySelection()) {
          if (plainCtrl) term.clearSelection()
          event.preventDefault()
          return false
        }
        return !shortcut
      }
      // 粘贴：Cmd+V / Ctrl+Shift+V，以及 Ctrl+V（shell 里几乎用不到 Ctrl+V 的字面输入）
      if (event.code === 'KeyV' && (shortcut || plainCtrl)) {
        paste()
        event.preventDefault()
        return false
      }
      if (event.code === 'KeyA' && isMac && event.metaKey) {
        term.selectAll()
        event.preventDefault()
        return false
      }

      const current = popupRef.current
      if (!current) {
        const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
        if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && navigateHistory(event.key)) {
          event.preventDefault()
          return false
        }
        return true
      }
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const step = event.key === 'ArrowDown' ? 1 : -1
          showPopup({ ...current, index: (current.index + step + current.items.length) % current.items.length })
          event.preventDefault()
          return false
        }
        case 'Tab':
        case 'ArrowRight':
          typedAt = Date.now()
          accept(current.items[current.index])
          event.preventDefault()
          return false
        case 'Escape':
          showPopup(null)
          event.preventDefault()
          return false
        default:
          return true
      }
    })

    const logcat = tab.kind === 'logcat' ? logcatBuffer(tab.id) : null
    const offData = listenTerminal(tab.id, (data) => {
      if (!logcat) return term.write(data, scheduleUpdate)
      // logcat 按行缓存，只把符合筛选的行写进终端；暂停时只缓存
      const added = logcat.push(data)
      const { filter, paused } = viewRef.current
      if (paused || !added.length) return
      const shown = filter.active ? added.filter(filter.match) : added
      if (shown.length) term.write(shown.map((line) => renderLine(line, filter.highlight)).join('\r\n') + '\r\n')
    })
    const input = term.onData((data) => {
      if (data === '\r') {
        // 刚翻出来就回车时回显可能还没到，不能读屏幕
        const line = historyNav.active ? historyNav.text : readInputLine(term)
        if (line) recordHistory(line)
        historyNav.reset()
        typedAt = 0
        showPopup(null)
      } else if (data === '\x7f' || !/[\x00-\x1f]/.test(data)) {
        // 可见字符或退格：等回显后刷新提示
        historyNav.reset()
        typedAt = Date.now()
      } else {
        historyNav.reset()
        typedAt = 0
        showPopup(null)
      }
      api.terminal.write(tab.id, data)
    })
    const observer = new ResizeObserver(() => fit())
    observer.observe(host)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      input.dispose()
      offData()
      term.dispose()
      termRef.current = null
    }
    // 每个 tab.id 对应一个进程，id 变化（重开）时重建 xterm
  }, [tab.id, tab.kind])

  useEffect(() => {
    if (!active) {
      showPopup(null)
      return
    }
    termRef.current?.fit()
    termRef.current?.term.focus()
  }, [active])

  useEffect(() => {
    const term = termRef.current?.term
    if (term) term.options.theme = THEMES[resolvedTheme]
  }, [resolvedTheme])

  // 筛选条件变化或取消暂停时，从缓存里重放符合条件的最近若干行
  useEffect(() => {
    if (tab.kind !== 'logcat') return
    const filter = compileFilter(tab.logcatFilter ?? DEFAULT_FILTER)
    const paused = Boolean(tab.paused)
    viewRef.current = { filter, paused }
    const term = termRef.current?.term
    if (!term || paused) return
    const lines = logcatBuffer(tab.id).lines
    const shown = (filter.active ? lines.filter(filter.match) : lines).slice(-term.options.scrollback!)
    term.reset()
    if (shown.length) term.write(shown.map((line) => renderLine(line, filter.highlight)).join('\r\n') + '\r\n')
    else if (filter.active) term.write(`\x1b[90m${t('[没有符合筛选条件的日志]')}\x1b[0m\r\n`)
  }, [tab.id, tab.kind, tab.logcatFilter, tab.paused])

  // 字体或字号变了，行列数随之变化，需要重新 fit 并通知设备端
  useEffect(() => {
    const current = termRef.current
    if (!current) return
    const family = terminalFontStack(terminalFont, monoFont)
    current.term.options.fontFamily = family
    current.term.options.fontSize = fontSize
    current.fit()
    // 字体文件按需加载，加载完字宽才准，再 fit 一次
    void document.fonts.load(`${fontSize}px ${family}`).then(() => {
      if (termRef.current !== current) return
      current.term.options.fontFamily = ''
      current.term.options.fontFamily = family
      current.fit()
    })
  }, [terminalFont, monoFont, fontSize])

  useEffect(() => {
    if (!tab.exit) return
    showPopup(null)
    const reason = tab.exit.reason ? t(tab.exit.reason) : t('退出码 {code}', { code: tab.exit.code })
    termRef.current?.term.write(`\r\n\x1b[90m${t('[会话已结束：{reason}]', { reason })}\x1b[0m\r\n`)
  }, [tab.exit])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const runMenu = (action: () => void) => {
    action()
    setMenu(null)
    termRef.current?.term.focus()
  }

  // 提示框放不下时向上弹出
  const wrapHeight = wrapRef.current?.clientHeight ?? 0
  const popupStyle = popup && {
    left: popup.x,
    ...(popup.y + 200 > wrapHeight && popup.y > 200 ? { bottom: wrapHeight - popup.y + popup.lineHeight } : { top: popup.y })
  }

  return (
    <div
      ref={wrapRef}
      className="terminal-host"
      style={{ display: active ? 'block' : 'none' }}
      onContextMenu={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, hasSelection: Boolean(termRef.current?.term.hasSelection()) })
      }}
      onDragOver={(e) => {
        if (!interactive || !hasDraggedFiles(e)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const paths = droppedPaths(e)
        if (!interactive || !paths.length) return
        e.preventDefault()
        // 插入到光标处，末尾留空格方便继续输入
        const powershell = tab.kind === 'local' && api.platform === 'win32'
        termRef.current?.term.paste(`${paths.map((p) => quotePath(p, powershell)).join(' ')} `)
        termRef.current?.term.focus()
      }}
    >
      <div ref={hostRef} className="terminal-xterm" />
      {popup && popupStyle && (
        <div className="suggest-popup" style={popupStyle} onMouseDown={(e) => e.preventDefault()}>
          {popup.items.map((item, i) => (
            <div
              key={item.label}
              className={`suggest-item${i === popup.index ? ' on' : ''}`}
              onMouseEnter={() => showPopup({ ...popup, index: i })}
              onClick={() => {
                accept(item)
                termRef.current?.term.focus()
              }}
            >
              <span className={`suggest-kind kind-${item.kind}`}>{KIND_LABEL()[item.kind]}</span>
              <span className="suggest-label mono">{item.label}</span>
              {item.desc && <span className="suggest-desc">{t(item.desc)}</span>}
            </div>
          ))}
          <div className="suggest-footer">{t('Tab / → 补全 · ↑↓ 选择 · Esc 关闭')}</div>
        </div>
      )}
      {menu && (
        <Exit key={`${menu.x},${menu.y}`}>
          <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <button disabled={!menu.hasSelection} onClick={() => runMenu(() => void copySelection())}>
              {t('复制')}
              <kbd>{isMac ? '⌘C' : 'Ctrl+C'}</kbd>
            </button>
            <button disabled={!interactive} onClick={() => runMenu(paste)}>
              {t('粘贴')}
              <kbd>{isMac ? '⌘V' : 'Ctrl+V'}</kbd>
            </button>
            <button onClick={() => runMenu(() => termRef.current?.term.selectAll())}>
              {t('全选')}
              <kbd>{isMac ? '⌘A' : ''}</kbd>
            </button>
            <button onClick={() => runMenu(() => termRef.current?.term.clear())}>{t('清屏')}</button>
          </div>
        </Exit>
      )}
      {dropping && <div className="terminal-drop-hint">{t('松开鼠标，插入文件的绝对路径')}</div>}
    </div>
  )
}
