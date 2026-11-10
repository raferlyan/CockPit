import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { MetricsEvent, MetricsRecordingFile, MetricsRecordingState, RecordedSession } from '@shared/metrics'

/** 录进文件的事件类型；进程表（300 行）、存储、线程等不录，否则一小时就是几十 MB */
const RECORDED = new Set<MetricsEvent['type']>(['load', 'app', 'frames', 'marker', 'foreground', 'focus'])
const EXT = '.ndjson'
const FORMAT_VERSION = 1

interface Session {
  stream: WriteStream
  state: MetricsRecordingState
}

/**
 * 把一台设备的采集推送原样写成 NDJSON（每行一个事件，首行是文件头），不限时长。
 * 文件放在 文稿/Cockpit/Metrics，打开后在状态面板里像实时数据一样浏览。
 */
export class MetricsRecorder {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly dir: string,
    private readonly describe: (serial: string) => string | undefined,
    private readonly notify: (event: MetricsEvent) => void,
    private readonly trash: (path: string) => Promise<void>,
    /** 开始录制时的现状（前台应用、关注应用）：这些只在变化时才推送，不先写进去回看时就不知道 */
    private readonly initial: (serial: string) => MetricsEvent[] = () => []
  ) {}

  async ensureDir(): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    return this.dir
  }

  status(): Record<string, MetricsRecordingState> {
    return Object.fromEntries([...this.sessions].map(([serial, s]) => [serial, s.state]))
  }

  async start(serial: string): Promise<MetricsRecordingState> {
    const existing = this.sessions.get(serial)
    if (existing) return existing.state
    await mkdir(this.dir, { recursive: true })
    const device = this.describe(serial)
    const startedAt = Date.now()
    const path = join(this.dir, `${safeName(device || serial)}_${stamp(new Date(startedAt))}${EXT}`)
    const stream = createWriteStream(path, { flags: 'wx' })
    await new Promise<void>((done, fail) => {
      stream.once('open', () => done())
      stream.once('error', fail)
    })
    stream.on('error', () => void this.stop(serial))
    const state: MetricsRecordingState = { path, startedAt }
    this.sessions.set(serial, { stream, state })
    stream.write(JSON.stringify({ type: 'header', version: FORMAT_VERSION, serial, device, startedAt }) + '\n')
    for (const event of this.initial(serial)) if (RECORDED.has(event.type)) stream.write(JSON.stringify(event) + '\n')
    this.notify({ type: 'recording', serial, recording: state })
    return state
  }

  async stop(serial: string): Promise<MetricsRecordingFile | undefined> {
    const session = this.sessions.get(serial)
    if (!session) return undefined
    this.sessions.delete(serial)
    await new Promise<void>((done) => session.stream.end(done))
    this.notify({ type: 'recording', serial, recording: null })
    return this.fileInfo(session.state.path)
  }

  /** 由 MetricsService 的推送调用；只写正在录制的设备 */
  write(event: MetricsEvent): void {
    if (!RECORDED.has(event.type)) return
    const session = this.sessions.get(event.serial)
    if (session) session.stream.write(JSON.stringify(event) + '\n')
  }

  async list(): Promise<MetricsRecordingFile[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const files = await Promise.all(names.filter((n) => n.endsWith(EXT)).map((n) => this.fileInfo(join(this.dir, n)).catch(() => undefined)))
    return files.filter((f): f is MetricsRecordingFile => !!f).sort((a, b) => b.mtime - a.mtime)
  }

  /** 读出整个会话；文件末尾可能是写到一半的行（录制中或异常退出），跳过解析不了的行 */
  async load(path: string): Promise<RecordedSession> {
    const file = this.inside(path)
    const session: RecordedSession = { name: basename(file), serial: '', history: [], appHistory: [], frameHistory: [], markers: [] }
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line) continue
      let event: (MetricsEvent & { type: string }) | { type: 'header'; serial: string; device?: string; startedAt: number }
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      switch (event.type) {
        case 'header':
          session.serial = event.serial
          session.device = event.device
          session.startedAt = event.startedAt
          break
        case 'load':
          session.history.push(event.sample)
          break
        case 'app':
          session.appHistory.push(event.sample)
          break
        case 'frames':
          session.frameHistory.push(event.stats)
          break
        case 'marker':
          session.markers.push(event.marker)
          break
        case 'foreground':
          session.foreground = event.foreground ?? undefined
          break
        case 'focus':
          session.focus = event.focus
          break
      }
    }
    if (!session.serial) throw new Error('不是 Cockpit 录制的状态数据文件')
    return session
  }

  async remove(path: string): Promise<void> {
    const file = this.inside(path)
    if ([...this.sessions.values()].some((s) => s.state.path === file)) throw new Error('这个文件正在录制，先停止录制')
    await this.trash(file)
  }

  dispose(): void {
    for (const serial of [...this.sessions.keys()]) void this.stop(serial)
  }

  /** 只允许访问录制目录里的 .ndjson，防止界面传来任意路径 */
  private inside(path: string): string {
    const file = resolve(String(path))
    const rel = relative(resolve(this.dir), file)
    if (!file.endsWith(EXT) || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(this.dir, rel) !== file) throw new Error('只能打开录制目录里的文件')
    return file
  }

  private async fileInfo(path: string): Promise<MetricsRecordingFile> {
    const info = await stat(path)
    return { path, name: basename(path), size: info.size, mtime: info.mtimeMs }
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'device'
}

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
