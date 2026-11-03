import type { CockpitApi } from '@shared/ipc'
import { errorMessage, notify, updateToast } from './notify/notifyStore'

/** 超过这个时间还没返回就提示“无响应”，请求本身不取消 */
const SLOW_AFTER = 8_000

/** 需要等结果的调用的中文名；没列出的不做无响应提示 */
const LABELS: Record<string, string> = {
  'devices.refreshInfo': '读取设备信息',
  'adb.connect': '无线连接',
  'adb.disconnect': '断开无线连接',
  'mirror.start': '启动投屏',
  'mirror.stop': '停止投屏',
  'terminal.open': '打开终端',
  'terminal.openSerial': '打开串口',
  'terminal.close': '关闭终端',
  'serial.list': '扫描串口',
  'metrics.snapshot': '读取设备状态',
  'files.list': '读取设备目录',
  'apps.list': '扫描应用',
  'device.screenshot': '截图'
}

function watch<T>(label: string, promise: Promise<T>): Promise<T> {
  let toastId: number | undefined
  const timer = setTimeout(() => {
    toastId = notify('warn', `「${label}」已等待 ${SLOW_AFTER / 1000} 秒仍无响应`, '可能是设备卡住或 adb 无响应，可以重新插拔设备，或查看底部状态栏的 adb 状态')
  }, SLOW_AFTER)
  return promise.then(
    (value) => {
      clearTimeout(timer)
      if (toastId !== undefined) updateToast(toastId, 'success', `「${label}」已完成`)
      return value
    },
    (error) => {
      clearTimeout(timer)
      // 已经提示过无响应的，把结果也告诉用户；其余错误由调用方展示或交给全局兜底
      if (toastId !== undefined) updateToast(toastId, 'error', `「${label}」失败`, errorMessage(error))
      throw error
    }
  )
}

function wrap<T extends object>(target: T, path: string): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(target)) {
    const name = path ? `${path}.${key}` : key
    if (typeof value === 'function') {
      const label = LABELS[name]
      result[key] = label ? (...args: unknown[]) => watch(label, (value as (...a: unknown[]) => Promise<unknown>)(...args)) : value
    } else if (value && typeof value === 'object') {
      result[key] = wrap(value as object, name)
    } else {
      result[key] = value
    }
  }
  return result as T
}

/** 渲染进程统一通过它调用主进程，耗时过长的请求会弹出无响应提示 */
export const api: CockpitApi = wrap(window.cockpit, '')
