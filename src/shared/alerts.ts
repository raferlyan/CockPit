/**
 * 告警规则。数值为 null 表示关闭这条规则。
 * 数值类规则要持续满足 forSeconds 才触发，触发后同一规则冷却 COOLDOWN 毫秒；条件解除时打一个“恢复”标记。
 */
export interface AlertRules {
  enabled: boolean
  /** CPU 温度高于（℃） */
  cpuTemp: number | null
  /** 温控等级达到（0–6，2 = 中等，系统开始主动降频） */
  thermalStatus: number | null
  /** 可用内存低于（%） */
  memoryAvailable: number | null
  /** 某个簇的频率上限低于硬件最高频率的（%） */
  throttle: number | null
  /** 前台应用卡顿帧占比高于（%） */
  jank: number | null
  /** 单帧耗时超过（毫秒），立即触发 */
  frameMs: number | null
  /** 关注应用崩溃、ANR 时弹提示 */
  appCrash: boolean
  /** 数值类规则需要持续满足的秒数 */
  forSeconds: number
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  enabled: true,
  cpuTemp: 45,
  thermalStatus: 2,
  memoryAvailable: 10,
  throttle: 70,
  jank: 20,
  frameMs: 300,
  appCrash: true,
  forSeconds: 10
}

/** 告警规则的标识，也用作标记的 label */
export type AlertRuleId = 'cpuTemp' | 'thermalStatus' | 'memoryAvailable' | 'throttle' | 'jank' | 'frameMs'

/** 同一条规则触发后，这段时间内不再重复触发 */
export const ALERT_COOLDOWN = 60_000

/** 卡顿规则用更短的持续时间：掉帧往往只持续几秒，等 10 秒就错过了 */
export const JANK_FOR_SECONDS = 5

/** 合并到默认值上，忽略存储里类型不对的字段 */
export function normalizeAlertRules(value: unknown): AlertRules {
  const rules = { ...DEFAULT_ALERT_RULES }
  if (!value || typeof value !== 'object') return rules
  const input = value as Record<string, unknown>
  for (const key of Object.keys(rules) as (keyof AlertRules)[]) {
    const v = input[key]
    if (typeof DEFAULT_ALERT_RULES[key] === 'boolean') {
      if (typeof v === 'boolean') (rules[key] as boolean) = v
    } else if (key === 'forSeconds') {
      if (typeof v === 'number' && v >= 1 && v <= 600) rules.forSeconds = Math.round(v)
    } else if (v === null || (typeof v === 'number' && Number.isFinite(v))) {
      ;(rules[key] as number | null) = v as number | null
    }
  }
  return rules
}
