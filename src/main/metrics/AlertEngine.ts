import { ALERT_COOLDOWN, DEFAULT_ALERT_RULES, JANK_FOR_SECONDS, type AlertRuleId, type AlertRules } from '@shared/alerts'
import type { LoadSample, MetricsEvent } from '@shared/metrics'

export interface AlertFiring {
  rule: AlertRuleId
  /** 触发时的读数，如 47.2°C；不翻译，界面直接显示 */
  value: string
  /** 条件解除 */
  resolved?: boolean
}

/**
 * 单台设备的告警判定，只看推送出去的采集事件，不自己采集。
 * 数值类规则持续满足 forSeconds 才触发，避免一瞬间的尖峰刷屏；触发后冷却一分钟；
 * 条件解除时报一次“恢复”。单帧超时是瞬时事件，没有持续和恢复。
 */
export class AlertEngine {
  private rules: AlertRules = DEFAULT_ALERT_RULES
  private readonly since = new Map<AlertRuleId, number>()
  private readonly active = new Set<AlertRuleId>()
  private readonly lastFired = new Map<AlertRuleId, number>()

  setRules(rules: AlertRules): void {
    this.rules = rules
    // 规则变了以后重新开始计时；已经在告警中的规则如果被关掉，不再报恢复
    this.since.clear()
    for (const rule of [...this.active]) if (!this.enabled(rule)) this.active.delete(rule)
  }

  observe(event: MetricsEvent, now = Date.now()): AlertFiring[] {
    if (!this.rules.enabled) return []
    const out: AlertFiring[] = []
    if (event.type === 'load') this.onLoad(event.sample, now, out)
    else if (event.type === 'frames') {
      const { stats } = event
      const jank = this.rules.jank
      if (jank !== null) {
        const bad = !stats.idle && stats.jankRatio !== undefined && stats.jankRatio > jank
        this.check('jank', bad, `${stats.jankRatio?.toFixed(0)}% · ${stats.pkg}`, now, JANK_FOR_SECONDS * 1000, out)
      }
      const frameMs = this.rules.frameMs
      if (frameMs !== null && stats.worstMs !== undefined && stats.worstMs > frameMs && this.cooledDown('frameMs', now)) {
        this.lastFired.set('frameMs', now)
        out.push({ rule: 'frameMs', value: `${Math.round(stats.worstMs)} ms · ${stats.pkg}` })
      }
    }
    return out
  }

  private onLoad(sample: LoadSample, now: number, out: AlertFiring[]): void {
    const forMs = this.rules.forSeconds * 1000
    const { cpuTemp, thermalStatus, memoryAvailable, throttle } = this.rules
    const temp = sample.thermal?.cpu
    if (cpuTemp !== null) this.check('cpuTemp', temp !== undefined && temp > cpuTemp, `${temp?.toFixed(1)}°C`, now, forMs, out)
    // 温控等级是系统自己的判断，本身已经有滞后，达到就报
    const status = sample.thermalStatus
    if (thermalStatus !== null) this.check('thermalStatus', status !== undefined && status >= thermalStatus, String(status), now, 0, out)
    const memory = sample.memory
    if (memoryAvailable !== null && memory) {
      const available = (memory.availableKB / memory.totalKB) * 100
      this.check('memoryAvailable', available < memoryAvailable, `${available.toFixed(0)}%`, now, forMs, out)
    }
    const clusters = sample.cpu?.clusters
    if (throttle !== null && clusters?.length) {
      const worst = clusters.reduce((a, b) => (b.limitMHz / b.maxMHz < a.limitMHz / a.maxMHz ? b : a))
      const ratio = (worst.limitMHz / worst.maxMHz) * 100
      this.check('throttle', ratio < throttle, `${worst.limitMHz} / ${worst.maxMHz} MHz`, now, forMs, out)
    }
  }

  private check(rule: AlertRuleId, bad: boolean, value: string, now: number, forMs: number, out: AlertFiring[]): void {
    if (!bad) {
      this.since.delete(rule)
      if (this.active.delete(rule)) out.push({ rule, value, resolved: true })
      return
    }
    const since = this.since.get(rule) ?? now
    this.since.set(rule, since)
    if (this.active.has(rule) || now - since < forMs || !this.cooledDown(rule, now)) return
    this.active.add(rule)
    this.lastFired.set(rule, now)
    out.push({ rule, value })
  }

  private cooledDown(rule: AlertRuleId, now: number): boolean {
    return now - (this.lastFired.get(rule) ?? -Infinity) >= ALERT_COOLDOWN
  }

  private enabled(rule: AlertRuleId): boolean {
    return this.rules.enabled && this.rules[rule] !== null
  }
}
