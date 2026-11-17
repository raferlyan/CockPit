import type { MirrorLayout } from '../store'

export interface MirrorWorkspaceVisibility {
  showMirror: boolean
  showStatus: boolean
}

/** 当前设备默认拥有独立工作区；只有显式网格模式跨设备展示投屏。 */
export function mirrorWorkspace(layout: MirrorLayout, focusedSerial: string | null, mirrorTiles: string[]): MirrorWorkspaceVisibility {
  const showMirror = layout === 'grid' ? mirrorTiles.length > 0 : focusedSerial !== null && mirrorTiles.includes(focusedSerial)
  return { showMirror, showStatus: !showMirror }
}
