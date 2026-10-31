import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const ADB_BIN = process.platform === 'win32' ? 'adb.exe' : 'adb'

/** SDK 的常见默认安装位置 */
function defaultSdkDirs(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [join(local, 'Android', 'Sdk')]
  }
  if (process.platform === 'darwin') return [join(home, 'Library', 'Android', 'sdk')]
  return [join(home, 'Android', 'Sdk')]
}

/**
 * 按设计文档的顺序列出候选路径：
 * 用户设置 → ANDROID_HOME / ANDROID_SDK_ROOT → PATH → SDK 默认位置 → 应用内置
 */
export function adbCandidates(options: { configured?: string; bundledDir?: string } = {}): string[] {
  const candidates: string[] = []
  if (options.configured) candidates.push(options.configured)

  for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const dir = process.env[env]
    if (dir) candidates.push(join(dir, 'platform-tools', ADB_BIN))
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, ADB_BIN))
  }

  for (const sdk of defaultSdkDirs()) candidates.push(join(sdk, 'platform-tools', ADB_BIN))

  if (options.bundledDir) candidates.push(join(options.bundledDir, 'platform-tools', ADB_BIN))

  return [...new Set(candidates)]
}

export async function resolveAdbPath(options: { configured?: string; bundledDir?: string } = {}): Promise<string | null> {
  // Windows 上没有可执行位，只检查存在
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK
  for (const candidate of adbCandidates(options)) {
    try {
      await access(candidate, mode)
      return candidate
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}
