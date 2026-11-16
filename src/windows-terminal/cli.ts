import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { promisify } from 'node:util'
import { Terminal } from '@xterm/xterm'
import { readInputLine } from '../shared/shell/inputLine'
import { CommandHistory } from './history'
import { SessionKeys } from './session'

const execute = promisify(execFile)
const { stdin, stdout } = process

function adbPath(): string {
  const filename = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]
  for (const root of sdk) {
    if (root && existsSync(join(root, 'platform-tools', filename))) return join(root, 'platform-tools', filename)
  }
  return filename
}

async function start() {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === '-s' && args[1])) throw Error('用法: cockpit-adb-shell [-s SERIAL]')
  if (!stdin.isTTY || !stdout.isTTY) throw Error('请在交互式终端运行。')
  const adb = adbPath()
  const options = { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }
  const serial = (await execute(adb, [...args, 'get-serialno'], options)).stdout.trim()
  if (!serial || serial === 'unknown') throw Error('请连接并授权一台 Android 设备，多台设备请用 -s SERIAL 指定。')
  const directory = join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'CockpitAdbShell')
  mkdirSync(directory, { recursive: true })
  const history = new CommandHistory(join(directory, 'history.sqlite'))
  const screen = new Terminal({ cols: stdout.columns, rows: stdout.rows, scrollback: 32, allowProposedApi: true })
  const shell = spawn(adb, ['-s', serial, 'shell', '-tt', '-e', 'none'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const keys = new SessionKeys(history, data => shell.stdin.write(data))
  let closed = false
  let painted = false
  let refreshAfter = 0
  let fetching = false
  let outputPending = 0

  function clearHint() {
    if (painted) stdout.write('\x1b[0K')
    painted = false
  }

  function drawHint() {
    clearHint()
    if (closed || outputPending) return
    const item = keys.candidate(readInputLine(screen))
    if (!item) return
    const hint = '  → ' + item.label + (item.desc ? ' · ' + item.desc : '')
    // Keep the preview on this row even when a wide character consumes two cells.
    let room = screen.cols - screen.buffer.active.cursorX - 1
    let clipped = ''
    for (const ch of hint.replace(/[\x00-\x1f\x7f-\x9f]/g, '')) {
      room -= ch.codePointAt(0)! > 127 ? 2 : 1
      if (room < 0) break
      clipped += ch
    }
    if (clipped.trim()) {
      stdout.write('\x1b7\x1b[90m' + clipped + '\x1b8')
      painted = true
    }
  }

  async function refreshPackages() {
    if (fetching || Date.now() < refreshAfter) return
    fetching = true
    try {
      const result = await execute(adb, ['-s', serial, 'shell', 'pm', 'list', 'packages'], options)
      keys.packages = result.stdout.split(/\r?\n/).filter(row => row.startsWith('package:')).map(row => row.slice(8).trim())
      if (!closed) drawHint()
    } catch { /* Static suggestions remain available during a package query failure. */ }
    finally { fetching = false; refreshAfter = Date.now() + 60_000 }
  }

  function receive(chunk: Buffer) {
    clearHint()
    outputPending++
    stdout.write(chunk)
    screen.write(chunk, () => {
      outputPending--
      if (closed || outputPending) return
      keys.echoed(readInputLine(screen))
      drawHint()
    })
  }

  function onKey(text: string | undefined, key: { sequence?: string }) {
    const data = key?.sequence ?? text
    if (!data || closed) return
    clearHint()
    keys.input(data, readInputLine(screen))
    drawHint()
    void refreshPackages()
  }

  function resize() {
    clearHint()
    screen.resize(stdout.columns || 80, stdout.rows || 24)
    drawHint()
  }

  function cleanup() {
    if (closed) return
    closed = true
    clearHint()
    stdin.off('keypress', onKey)
    stdout.off('resize', resize)
    stdin.setRawMode(false)
    stdin.pause()
    process.off('exit', kill)
    history.close()
    screen.dispose()
  }
  function kill() { shell.kill() }

  stdout.write('Cockpit ADB Shell  ·  Tab / → 补全  ·  ↑↓ 选候选或翻历史  ·  Esc 收起提示\r\n')
  shell.stdout.on('data', receive)
  shell.stderr.pipe(process.stderr, { end: false })
  shell.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && !closed) process.stderr.write(String(error) + '\n')
  })
  shell.once('error', error => { cleanup(); process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
  shell.once('close', code => { cleanup(); process.exitCode = code ?? 1 })
  process.once('exit', kill)
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.on('keypress', onKey)
  stdout.on('resize', resize)
  stdin.resume()
  void refreshPackages()
}

start().catch(error => {
  console.error('Cockpit ADB Shell:', error.code === 'ENOENT' ? '找不到 adb，请安装 Android SDK Platform-Tools 并加入 PATH。' : error.message)
  process.exitCode = 1
})
