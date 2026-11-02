import { basename } from 'node:path'
import type { RemoteEntry, TransferResult } from '@shared/files'
import type { AdbClient } from '../adb/AdbClient'
import { parseLsOutput, remoteJoin, shellQuote } from './remotePath'

/** 大文件走 USB 2.0 也可能要几分钟，给足时间 */
const TRANSFER_TIMEOUT = 30 * 60_000

/** 本机与设备之间的文件传输，都通过 adb push / pull 完成 */
export class FileService {
  constructor(private readonly adb: AdbClient) {}

  /** 列出设备目录，目录排在前面 */
  async list(serial: string, dir: string): Promise<RemoteEntry[]> {
    // 末尾加 / 让符号链接目录（如 /sdcard）列出的是目标内容
    const path = dir.endsWith('/') ? dir : `${dir}/`
    const out = await this.adb.shell(serial, `ls -1pa ${shellQuote(path)}`, { timeout: 15_000 })
    return parseLsOutput(out)
  }

  /** 逐个上传到设备目录，目录不存在时先创建；单个失败不影响其它文件 */
  async push(serial: string, localPaths: string[], remoteDir: string): Promise<TransferResult[]> {
    await this.adb.shell(serial, `mkdir -p ${shellQuote(remoteDir)}`)
    const results: TransferResult[] = []
    for (const local of localPaths) {
      const target = remoteJoin(remoteDir, basename(local))
      try {
        const out = await this.adb.exec(['-s', serial, 'push', local, target], { timeout: TRANSFER_TIMEOUT })
        results.push({ source: local, target, ok: true, message: lastLine(out) })
      } catch (error) {
        results.push({ source: local, target, ok: false, message: (error as Error).message })
      }
    }
    return results
  }

  /** 把设备上的文件或目录下载到本机目录 */
  async pull(serial: string, remotePath: string, localDir: string): Promise<TransferResult> {
    try {
      const out = await this.adb.exec(['-s', serial, 'pull', remotePath, localDir], { timeout: TRANSFER_TIMEOUT })
      return { source: remotePath, target: localDir, ok: true, message: lastLine(out) }
    } catch (error) {
      return { source: remotePath, target: localDir, ok: false, message: (error as Error).message }
    }
  }

  /** 已安装应用的包名，供终端补全使用 */
  async packages(serial: string): Promise<string[]> {
    const out = await this.adb.shell(serial, 'pm list packages', { timeout: 15_000 })
    return out
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^package:/, ''))
      .filter(Boolean)
      .sort()
  }
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop() ?? ''
}
