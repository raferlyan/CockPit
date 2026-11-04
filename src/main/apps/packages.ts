import type { AppPackage } from '@shared/apps'

function names(text: string): Set<string> {
  const set = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim().replace(/^package:/, '')
    if (name) set.add(name)
  }
  return set
}

/** `pm list packages -f` 的行形如 `package:/data/app/~~x/base.apk=com.example`，路径里也可能有 =，按最后一个切 */
function paths(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const body = line.trim().replace(/^package:/, '')
    const at = body.lastIndexOf('=')
    if (at > 0) map.set(body.slice(at + 1), body.slice(0, at))
  }
  return map
}

/**
 * 合并几次 pm list packages 的输出：
 * all = -u（含已卸载），installed = -f（当前用户已安装，带路径），third = -3，disabled = -d。
 */
export function parsePackageList(out: { all: string; installed: string; third: string; disabled: string; times?: string }): AppPackage[] {
  const times = parseInstallTimes(out.times ?? '')
  const installed = paths(out.installed)
  const all = names(out.all)
  for (const name of installed.keys()) all.add(name)
  const third = names(out.third)
  const disabled = names(out.disabled)
  return [...all]
    .map((name) => ({
      name,
      kind: third.has(name) ? ('user' as const) : ('system' as const),
      disabled: disabled.has(name),
      uninstalled: !installed.has(name),
      apkPath: installed.get(name),
      ...times.get(name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 解析 `dumpsys package packages` 里每个包的安装时间：
 * `  Package [com.example] (1a2b3c):` 之后的 `firstInstallTime=2024-01-02 03:04:05`、`lastUpdateTime=...`。
 * Android 14 起 firstInstallTime 挪到了每个用户的行里，取第一次出现的（用户 0）。
 */
export function parseInstallTimes(text: string): Map<string, { firstInstallTime?: number; lastUpdateTime?: number }> {
  const result = new Map<string, { firstInstallTime?: number; lastUpdateTime?: number }>()
  let current: { firstInstallTime?: number; lastUpdateTime?: number } | undefined
  for (const line of text.split(/\r?\n/)) {
    const pkg = line.match(/^\s*Package \[([^\]]+)\]/)
    if (pkg) {
      current = {}
      result.set(pkg[1], current)
      continue
    }
    if (!current) continue
    for (const match of line.matchAll(/(firstInstallTime|lastUpdateTime)=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g)) {
      const key = match[1] as 'firstInstallTime' | 'lastUpdateTime'
      if (current[key] !== undefined) continue
      const time = new Date(match[2].replace(' ', 'T')).getTime()
      if (Number.isFinite(time)) current[key] = time
    }
  }
  return result
}
