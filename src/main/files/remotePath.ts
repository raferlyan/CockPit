import type { DiskUsage, DiskUsageEntry, RemoteEntry } from '@shared/files'

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

export const DU_SEP = '__COCKPIT_DU__'

/**
 * 统计一层目录占用的 shell 脚本：先 cd 进去（/sdcard 这类符号链接也能跟随），
 * `du -akd 1 -x .` 列出每个子项的大小（不跨分区，避免统计 / 时钻进 /proc、/data），
 * 老设备的 du 不支持 -d 时退回逐项 `du -sk`；分隔符后列出真正的子目录。
 */
export function diskUsageCommand(dir: string): string {
  return [
    `cd ${shellQuote(dir)} || exit 1`,
    `{ du -akd 1 -x . 2>&1 || for f in .* *; do [ "$f" = . ] || [ "$f" = .. ] || [ ! -e "$f" ] || du -sk "$f" 2>&1; done; }`,
    `echo ${DU_SEP}`,
    `for f in .* *; do [ "$f" = . ] || [ "$f" = .. ] && continue; [ -d "$f" ] && [ ! -L "$f" ] && echo "$f"; done`,
    'exit 0'
  ].join('; ')
}

/** 解析 diskUsageCommand 的输出 */
export function parseDiskUsage(dir: string, out: string, root: boolean): DiskUsage {
  const [duText = '', dirText = ''] = out.split(DU_SEP)
  const dirs = new Set(dirText.split(/\r?\n/).map((l) => l.replace(/\r$/, '')).filter(Boolean))
  const sizes = new Map<string, number>()
  let totalKB = 0
  let partial = false
  for (const raw of duText.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '')
    const match = line.match(/^(\d+)\s+(.+)$/)
    if (!match) {
      if (/permission denied|not permitted/i.test(line)) partial = true
      continue
    }
    const size = Number(match[1])
    const path = match[2].replace(/^\.\//, '')
    if (path === '.') totalKB = size
    else if (!path.includes('/')) sizes.set(path, size)
  }
  // 退回逐项统计时没有总计行
  if (!totalKB) for (const size of sizes.values()) totalKB += size
  const entries: DiskUsageEntry[] = [...sizes].map(([name, sizeKB]) => ({ name, sizeKB, dir: dirs.has(name) }))
  // 读不到大小的子目录也列出来，大小记 0
  for (const name of dirs) if (!sizes.has(name)) entries.push({ name, sizeKB: 0, dir: true })
  entries.sort((a, b) => b.sizeKB - a.sizeKB || a.name.localeCompare(b.name))
  return { dir, totalKB, entries, partial, root }
}

export const MOUNTS_SEP = '__COCKPIT_MOUNTS__'

/**
 * 上传前检查目标目录的 shell 脚本：建目录、看能否写、adbd 身份，
 * 找到最近的已存在上级目录并解析符号链接（/sdcard → /storage/emulated/0），最后附上挂载表。
 */
export function targetProbeCommand(dir: string): string {
  const q = shellQuote(dir)
  return [
    `err=$(mkdir -p ${q} 2>&1)`,
    `[ -d ${q} ] && echo E=1`,
    `[ -w ${q} ] && echo W=1`,
    'echo U=$(id -u)',
    `p=${q}`,
    'while [ ! -e "$p" ] && [ "$p" != / ] && [ -n "$p" ]; do p=$(dirname "$p"); done',
    'echo R=$(readlink -f "$p" 2>/dev/null || echo "$p")',
    'echo "M=$(echo "$err" | head -n 1)"',
    `echo ${MOUNTS_SEP}`,
    'cat /proc/mounts 2>/dev/null',
    'exit 0'
  ].join('; ')
}

export interface MountEntry {
  device: string
  point: string
  type: string
  readOnly: boolean
}

export interface TargetProbe {
  exists: boolean
  writable: boolean
  /** adbd 的 uid，0 表示 adb root */
  uid: number
  /** 目标（或最近的已存在上级目录）解析符号链接后的真实路径 */
  realPath: string
  /** mkdir 失败时的错误 */
  mkdirError: string
  /** 目标所在的挂载点，读不到挂载表时为 undefined */
  mount?: MountEntry
}

/** /proc/mounts 把空格等写成 \040 这样的八进制转义 */
function unescapeMount(text: string): string {
  return text.replace(/\\([0-7]{3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)))
}

export function parseMounts(text: string): MountEntry[] {
  const mounts: MountEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const [device, point, type, options] = line.trim().split(/\s+/)
    if (!device || !point || !options) continue
    mounts.push({ device, point: unescapeMount(point), type, readOnly: options.split(',').includes('ro') })
  }
  return mounts
}

/** 路径所在的挂载点：最长前缀匹配，同一挂载点挂了多次时后挂的生效 */
export function findMount(mounts: MountEntry[], path: string): MountEntry | undefined {
  let best: MountEntry | undefined
  for (const mount of mounts) {
    const point = mount.point.replace(/\/+$/, '') || '/'
    const covers = point === '/' || path === point || path.startsWith(`${point}/`)
    if (covers && (!best || point.length >= (best.point.replace(/\/+$/, '') || '/').length)) best = mount
  }
  return best
}

export function parseTargetProbe(out: string): TargetProbe {
  const [head = '', mountText = ''] = out.split(MOUNTS_SEP)
  const values = new Map<string, string>()
  for (const line of head.split(/\r?\n/)) {
    const match = line.replace(/\r$/, '').match(/^([A-Z])=(.*)$/)
    if (match) values.set(match[1], match[2])
  }
  const realPath = values.get('R') || '/'
  return {
    exists: values.get('E') === '1',
    writable: values.get('W') === '1',
    uid: Number(values.get('U') ?? -1),
    realPath,
    mkdirError: (values.get('M') ?? '').trim(),
    mount: findMount(parseMounts(mountText), realPath)
  }
}
