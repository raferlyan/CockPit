import { isThrottled, type CpuCluster } from '@shared/metrics'
import { t } from '../i18n'

/** 数值的严重程度，卡片、HUD 用它决定颜色 */
export type Level = 'ok' | 'warn' | 'danger'

/** [提醒, 严重] 阈值，HUD 与状态面板共用，后续告警规则也从这里取默认值 */
export const THRESHOLDS = {
  cpu: [70, 90],
  memory: [80, 90],
  cpuTemp: [45, 55],
  iowait: [10, 25],
  psi: [10, 30]
} satisfies Record<string, [number, number]>

export function levelOf(value: number | undefined, [warn, danger]: [number, number]): Level {
  if (value === undefined) return 'ok'
  if (value >= danger) return 'danger'
  if (value >= warn) return 'warn'
  return 'ok'
}

/** 温控等级 0–6 的名称，对应 PowerManager.THERMAL_STATUS_* */
export function thermalStatusLabel(status: number): string {
  return [t('正常'), t('轻微'), t('中等'), t('严重'), t('紧急'), t('危急'), t('即将关机')][status] ?? String(status)
}

/** 轻微（1）只是提示，中等（2）开始系统会主动降频 */
export function thermalStatusLevel(status: number | undefined): Level {
  if (status === undefined || status <= 1) return 'ok'
  return status === 2 ? 'warn' : 'danger'
}

/** 被限频的簇：簇名 + 上限 / 硬件最高，如「大核 1.8 / 3.2 GHz」 */
export function throttleSummary(clusters: CpuCluster[] | undefined): string | undefined {
  if (!clusters) return undefined
  const parts = clusters
    .map((c, i) => ({ c, name: clusterName(i, clusters.length) }))
    .filter(({ c }) => isThrottled(c))
    .map(({ c, name }) => `${name} ${ghz(c.limitMHz)} / ${ghz(c.maxMHz)} GHz`)
  return parts.length ? parts.join(' · ') : undefined
}

/** 按簇数量命名：1 簇不分；2 簇小 / 大；3 簇及以上小 / 中 / 大（中间的都叫中核） */
export function clusterName(index: number, count: number): string {
  if (count <= 1) return t('全部核心')
  if (index === 0) return t('小核')
  if (index === count - 1) return t('大核')
  return t('中核')
}

function ghz(mhz: number): string {
  return (mhz / 1000).toFixed(1)
}
