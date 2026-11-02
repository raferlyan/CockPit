import { api } from '../api'

const HISTORY_KEY = 'cockpit.shell.history'
const MAX_HISTORY = 300

function loadHistory(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 所有终端共用的命令历史，越新越靠前 */
let history = loadHistory()

export function getHistory(): string[] {
  return history
}

export function recordHistory(command: string): void {
  const trimmed = command.trim()
  if (!trimmed) return
  history = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // 存储不可用时只在本次运行内保留
  }
}

const PACKAGES_TTL = 60_000
const packageCache = new Map<string, { at: number; list: string[] }>()
const loading = new Set<string>()

/** 设备上的包名；首次调用时在后台拉取，拉到之前返回空数组 */
export function getPackages(serial: string): string[] {
  const cached = packageCache.get(serial)
  if ((!cached || Date.now() - cached.at > PACKAGES_TTL) && !loading.has(serial)) {
    loading.add(serial)
    api.devices
      .packages(serial)
      .then((list) => packageCache.set(serial, { at: Date.now(), list }))
      // 拉不到包名只是少了这类提示，不打扰用户
      .catch(() => packageCache.set(serial, { at: Date.now(), list: cached?.list ?? [] }))
      .finally(() => loading.delete(serial))
  }
  return cached?.list ?? []
}
