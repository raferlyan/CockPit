/**
 * 终端标签跟设备绑定：切换设备只显示这台设备的标签，其它设备的标签隐藏但继续运行。
 * 本机终端和串口不属于任何设备（serial 为空），在哪台设备下都显示。
 */
interface ScopedTab {
  id: string
  serial: string
}

export function visibleTabs<T extends ScopedTab>(tabs: T[], focused: string | null): T[] {
  return tabs.filter((tab) => !tab.serial || tab.serial === focused)
}

/** 记住每台设备上次看的标签；没记录或那个标签已关闭时，取最后一个 */
export function activeTabId<T extends ScopedTab>(tabs: T[], focused: string | null, activeBy: Record<string, string>): string | null {
  const visible = visibleTabs(tabs, focused)
  const remembered = activeBy[focused ?? '']
  return visible.some((tab) => tab.id === remembered) ? remembered : (visible.at(-1)?.id ?? null)
}

/** 关闭标签后，每个记着它的设备改看同一设备下相邻的标签 */
export function activeAfterClose<T extends ScopedTab>(tabs: T[], closedId: string, activeBy: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  const remaining = tabs.filter((tab) => tab.id !== closedId)
  for (const [scope, id] of Object.entries(activeBy)) {
    if (id !== closedId) {
      next[scope] = id
      continue
    }
    const before = visibleTabs(tabs, scope || null)
    const after = visibleTabs(remaining, scope || null)
    const neighbor = after[Math.min(before.findIndex((tab) => tab.id === closedId), after.length - 1)]
    if (neighbor) next[scope] = neighbor.id
  }
  return next
}

/** 重新连接后标签换了 id，所有记着旧 id 的设备都要跟着改 */
export function replaceActive(activeBy: Record<string, string>, oldId: string, newId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(activeBy).map(([scope, id]) => [scope, id === oldId ? newId : id]))
}
