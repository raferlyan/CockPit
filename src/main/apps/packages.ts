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
export function parsePackageList(out: { all: string; installed: string; third: string; disabled: string }): AppPackage[] {
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
      apkPath: installed.get(name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
