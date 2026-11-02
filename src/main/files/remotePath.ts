import type { RemoteEntry } from '@shared/files'

/** 包成设备 shell 里的单引号字符串 */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** 设备上的路径总是 POSIX 风格 */
export function remoteJoin(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** 解析 `ls -1pa` 的输出：目录名以 / 结尾；去掉 . 和 ..，目录在前、按名称排序 */
export function parseLsOutput(out: string): RemoteEntry[] {
  const entries: RemoteEntry[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '')
    if (!line || line === './' || line === '../' || line === '.' || line === '..') continue
    const dir = line.endsWith('/')
    entries.push({ name: dir ? line.slice(0, -1) : line, dir })
  }
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}
