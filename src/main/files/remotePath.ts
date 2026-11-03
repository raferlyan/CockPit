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

/**
 * 列目录的 shell 脚本。不用 `ls -p`：它只给真正的目录加 /，
 * 根目录下的 /system、/product、/sdcard 等在很多设备上是指向目录的符号链接，会被当成文件。
 * `[ -d ]` 会跟随符号链接，输出格式与 `ls -1pa` 相同（目录名以 / 结尾）。
 */
export function listCommand(dir: string): string {
  return [
    `cd ${shellQuote(dir)} || exit 1`,
    // 有 x 没有 r 权限时 glob 不展开，会得到一个空目录，这里明确报错
    `[ -r . ] || { echo "Permission denied" >&2; exit 1; }`,
    `for f in .* *; do [ "$f" = . ] || [ "$f" = .. ] && continue; [ -e "$f" ] || [ -L "$f" ] || continue; if [ -d "$f" ]; then echo "$f/"; else echo "$f"; fi; done`
  ].join('; ')
}

/** adb / 设备 shell 报出的权限类错误，换 root 身份可能解决 */
export function isPermissionError(message: string): boolean {
  return /permission denied|not permitted|EACCES|EPERM/i.test(message)
}
