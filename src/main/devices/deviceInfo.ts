import type { DeviceInfo, RootState } from '@shared/models'

const SEP = '__COCKPIT_SEP__'

/**
 * 一次 shell 调用拿到设备信息与 root 粗略状态，减少 adb 往返。
 * su 的探测只看是否存在，不执行，避免触发 Magisk 授权弹窗。
 */
export const DEVICE_INFO_COMMAND = [
  'getprop',
  `echo ${SEP}`,
  'wm size',
  `echo ${SEP}`,
  'id -u',
  `echo ${SEP}`,
  'command -v su 2>/dev/null || which su 2>/dev/null || ls /system/xbin/su /system/bin/su /sbin/su 2>/dev/null',
  // 没有 su 时上一条返回非 0，这里不应视为失败
  'exit 0'
].join('; ')

/** 解析 getprop 输出：`[ro.product.model]: [GM1910]` */
export function parseGetprop(text: string): Map<string, string> {
  const props = new Map<string, string>()
  for (const match of text.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]\s*$/gm)) {
    props.set(match[1], match[2])
  }
  return props
}

/** 解析 `wm size`，优先 Override size（用户改过分辨率时） */
export function parseWmSize(text: string): string | undefined {
  const override = text.match(/Override size:\s*(\d+x\d+)/)
  if (override) return override[1]
  return text.match(/Physical size:\s*(\d+x\d+)/)?.[1]
}

export function parseRootState(idOutput: string, suOutput: string): RootState {
  const uid = idOutput.trim()
  if (uid === '0') return 'adbd'
  if (!/^\d+$/.test(uid)) return 'unknown'
  return suOutput.trim().length > 0 ? 'su-available' : 'none'
}

export function parseDeviceInfoOutput(text: string): { info: DeviceInfo; root: RootState } {
  const [propText = '', wmText = '', idText = '', suText = ''] = text.split(SEP)
  const props = parseGetprop(propText)
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = props.get(key)
      if (value) return value
    }
    return ''
  }

  return {
    info: {
      manufacturer: get('ro.product.manufacturer', 'ro.product.vendor.manufacturer'),
      model: get('ro.product.model', 'ro.product.vendor.model'),
      brand: get('ro.product.brand', 'ro.product.vendor.brand'),
      androidVersion: get('ro.build.version.release_or_codename', 'ro.build.version.release'),
      sdk: Number(get('ro.build.version.sdk')) || 0,
      abi: get('ro.product.cpu.abi'),
      resolution: parseWmSize(wmText)
    },
    root: parseRootState(idText, suText)
  }
}
