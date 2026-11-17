import type { CollapsedPanes } from './settingsStore'

const SIDEBAR_TARGETS = new Set(['device-list', 'connect', 'collapse-sidebar'])
const SIDE_TARGETS = new Set(['device-detail', 'btn-mirror', 'btn-transfer', 'btn-apps', 'btn-screenshot', 'btn-trace'])

/** 以进入向导前的布局为基准，只临时展开当前步骤真正需要的区域。 */
export function tourCollapsed(saved: CollapsedPanes, target: string | undefined): CollapsedPanes {
  if (target && SIDEBAR_TARGETS.has(target)) return { ...saved, sidebar: false }
  if (target && SIDE_TARGETS.has(target)) return { ...saved, side: false }
  if (target === 'terminal-actions') return { ...saved, terminal: false }
  return saved
}
