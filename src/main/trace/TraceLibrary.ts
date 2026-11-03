import { mkdir, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, isAbsolute } from 'node:path'
import type { TraceFile } from '@shared/trace'

const TRACE_EXTENSIONS = new Set(['.pftrace', '.perfetto-trace', '.trace', '.pb', '.json', '.gz', '.zip', '.ctrace', '.html'])
const LIST_LIMIT = 100

/** 录制下来的 trace 统一放在一个目录里，列表按修改时间倒序 */
export class TraceLibrary {
  constructor(
    readonly dir: string,
    private readonly trash: (path: string) => Promise<void>
  ) {}

  async ensureDir(): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    return this.dir
  }

  async list(): Promise<TraceFile[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const files = await Promise.all(
      names
        .filter((name) => !name.startsWith('.') && TRACE_EXTENSIONS.has(extname(name).toLowerCase()))
        .map(async (name) => {
          const path = join(this.dir, name)
          try {
            const info = await stat(path)
            return info.isFile() ? { path, name, size: info.size, mtime: info.mtimeMs } : null
          } catch {
            return null
          }
        })
    )
    return files
      .filter((f): f is TraceFile => f !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, LIST_LIMIT)
  }

  /** 移到废纸篓而不是直接删除；只允许操作本目录下的文件 */
  async remove(path: string): Promise<void> {
    if (!this.contains(path)) throw new Error('只能删除 trace 目录里的文件')
    await this.trash(path)
  }

  /** 设备名 + 预设 + 时间，例如 OnePlus_GM1910_jank_20261103_221530.pftrace */
  fileName(label: string, preset: string, date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    return `${label.replace(/[^\w.-]+/g, '_')}_${preset}_${stamp}.pftrace`
  }

  private contains(path: string): boolean {
    const rel = relative(this.dir, path)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
}
