import { create } from 'zustand'
import { en } from './en'

export type Language = 'zh' | 'en'

/** 当前语言；由 settingsStore 在启动和用户切换时写入，这里不依赖设置模块，便于单测 */
const useLanguageStore = create<{ language: Language }>(() => ({ language: 'zh' }))

export function setLanguage(language: Language): void {
  useLanguageStore.setState({ language })
}

type Params = Record<string, string | number | undefined | null>

/**
 * 界面文字以中文原文作 key，英文从 en.ts 里查；没有译文的退回中文原文。
 * `{name}` 占位符用 params 替换。切换语言时 App 根组件订阅了 language 会整体重渲染，
 * 组件不会被卸载，终端、投屏等会话不受影响。
 */
export function t(zh: string, params?: Params): string {
  const text = currentLanguage() === 'en' ? (en[zh] ?? zh) : zh
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (params[key] == null ? match : String(params[key])))
}

export function currentLanguage(): Language {
  return useLanguageStore.getState().language
}

/** 订阅语言变化，放在根组件里触发整棵树重渲染 */
export function useLanguage(): Language {
  return useLanguageStore((s) => s.language)
}

/** 本地化的日期时间，如 2024-05-01 12:30 */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
