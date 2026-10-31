import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import { listenTerminal, type TerminalTab } from './terminalStore'

const isMac = api.platform === 'darwin'

const THEME = {
  background: '#14161a',
  foreground: '#e3e6eb',
  cursor: '#e3e6eb',
  selectionBackground: '#4c9aff55'
}

/**
 * 一个标签对应一个 xterm 实例。隐藏的标签保持挂载（display:none），
 * 切回来时不丢滚动缓冲；重新可见时按容器尺寸重新 fit。
 */
export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ term: Terminal; fit: () => void } | null>(null)

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 12,
      theme: THEME,
      cursorBlink: tab.kind === 'shell',
      disableStdin: tab.kind === 'logcat',
      // logcat 刷屏快，多留一些
      scrollback: tab.kind === 'logcat' ? 20_000 : 5_000,
      macOptionIsMeta: true
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

    // macOS 上 Cmd+C/V 由系统编辑菜单处理，xterm 自带 copy/paste 事件支持；
    // Windows 上 Ctrl+C 要留给 shell 发 SIGINT，复制粘贴用 Ctrl+Shift+C/V
    term.attachCustomKeyEventHandler((event) => {
      if (isMac || event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.code === 'KeyC') {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
        event.preventDefault()
        return false
      }
      if (event.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => term.paste(text))
        event.preventDefault()
        return false
      }
      return true
    })

    const offData = listenTerminal(tab.id, (data) => term.write(data))
    const input = term.onData((data) => api.terminal.write(tab.id, data))
    const observer = new ResizeObserver(() => fit())
    observer.observe(host)

    return () => {
      observer.disconnect()
      input.dispose()
      offData()
      term.dispose()
      termRef.current = null
    }
    // 每个 tab.id 对应一个进程，id 变化（重开）时重建 xterm
  }, [tab.id, tab.kind])

  useEffect(() => {
    if (!active) return
    termRef.current?.fit()
    termRef.current?.term.focus()
  }, [active])

  useEffect(() => {
    if (!tab.exit) return
    const reason = tab.exit.reason ?? `退出码 ${tab.exit.code}`
    termRef.current?.term.write(`\r\n\x1b[90m[会话已结束：${reason}]\x1b[0m\r\n`)
  }, [tab.exit])

  return <div ref={hostRef} className="terminal-host" style={{ display: active ? 'block' : 'none' }} />
}
