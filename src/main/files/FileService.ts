import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DiskUsage, RemoteEntry, TransferProgress, TransferResult } from '@shared/files'
import type { AdbClient } from '../adb/AdbClient'
import { syncPush } from '../adb/sync'
import { diskUsageCommand, isPermissionError, listCommand, parseDiskUsage, parseLsOutput, remoteJoin, shellQuote } from './remotePath'

/** 大文件走 USB 2.0 也可能要几分钟，给足时间 */
const TRANSFER_TIMEOUT = 30 * 60_000
/** root 复制已在设备上的文件，正常几秒内完成；su 授权弹窗没人点时不至于一直等 */
const ROOT_COPY_TIMEOUT = 2 * 60_000
/** /data 这种文件多的分区 du 要跑很久 */
const DU_TIMEOUT = 3 * 60_000
/** root 中转用的临时目录，shell 用户可读写 */
const STAGING_DIR = '/data/local/tmp'

/** su 的两种调用方式：Magisk / KernelSU 的 `su -c`，AOSP userdebug 的 `su 0 sh -c` */
type SuStyle = 'dash-c' | 'uid' | 'none'

/**
 * 本机与设备之间的文件传输。
 * 每次调用都是独立的 adb 连接，不继承终端里 su 之后的身份；
 * 普通身份遇到权限问题时，若设备可以 su，就自动经 /data/local/tmp 用 root 中转。
 */
export class FileService {
  private readonly suStyles = new Map<string, Promise<SuStyle>>()

  constructor(private readonly adb: AdbClient) {}

  /** 列出设备目录，目录排在前面；无权限时尝试 root */
  async list(serial: string, dir: string): Promise<RemoteEntry[]> {
    const command = listCommand(dir)
    try {
      return parseLsOutput(await this.adb.shell(serial, command, { timeout: 15_000 }))
    } catch (error) {
      if (/No such file or directory/i.test((error as Error).message)) throw new Error(`目录不存在：${dir}`)
      if (/Not a directory/i.test((error as Error).message)) throw new Error(`不是目录：${dir}`)
      if (!isPermissionError((error as Error).message)) throw error
      const out = await this.asRoot(serial, command, new Error(`${dir}: Permission denied`))
      return parseLsOutput(out)
    }
  }

  /**
   * 逐个上传到设备目录，单个失败不影响其它文件。
   * 普通文件走 sync 协议并回报进度；目录交给 `adb push`，只回报开始和结束。
   */
  async push(
    serial: string,
    localPaths: string[],
    remoteDir: string,
    onProgress?: (progress: TransferProgress) => void,
    signal?: AbortSignal
  ): Promise<TransferResult[]> {
    const sizes = await Promise.all(localPaths.map((p) => stat(p).then((s) => (s.isFile() ? s.size : 0)).catch(() => 0)))
    const total = sizes.reduce((a, b) => a + b, 0)
    const writable = await this.prepareDir(serial, remoteDir, signal)

    const results: TransferResult[] = []
    let done = 0
    for (const [index, local] of localPaths.entries()) {
      const name = basename(local)
      const target = remoteJoin(remoteDir, name)
      if (signal?.aborted) {
        results.push({ source: local, target, ok: false, message: '已取消' })
        continue
      }
      const report = (fileSent: number) =>
        onProgress?.({ index, count: localPaths.length, name, fileSent, fileTotal: sizes[index], sent: done + fileSent, total })
      try {
        const viaRoot = !writable
        if (viaRoot) await this.pushViaRoot(serial, local, remoteDir, target, report, undefined, signal)
        else {
          try {
            await this.pushOne(serial, local, target, report, signal)
          } catch (error) {
            if (!isPermissionError((error as Error).message)) throw error
            await this.pushViaRoot(serial, local, remoteDir, target, report, error as Error, signal)
          }
        }
        results.push({ source: local, target, ok: true, message: viaRoot ? '已通过 root 写入' : '' })
      } catch (error) {
        results.push({ source: local, target, ok: false, message: explainWriteError((error as Error).message) })
      }
      report(sizes[index])
      done += sizes[index]
    }
    return results
  }

  /** 把设备上的文件或目录下载到本机目录；无权限时用 root 复制到临时目录再拉取 */
  async pull(serial: string, remotePath: string, localDir: string): Promise<TransferResult> {
    try {
      const out = await this.adb.exec(['-s', serial, 'pull', remotePath, localDir], { timeout: TRANSFER_TIMEOUT })
      return { source: remotePath, target: localDir, ok: true, message: lastLine(out) }
    } catch (error) {
      if (!isPermissionError((error as Error).message)) {
        return { source: remotePath, target: localDir, ok: false, message: (error as Error).message }
      }
      try {
        const out = await this.pullViaRoot(serial, remotePath, localDir, error as Error)
        return { source: remotePath, target: localDir, ok: true, message: `已通过 root 读取 · ${lastLine(out)}` }
      } catch (rootError) {
        return { source: remotePath, target: localDir, ok: false, message: (rootError as Error).message }
      }
    }
  }

  /** 统计目录下一层各项的占用；asRoot 时用 su 统计，读得到 /data 下各应用的数据 */
  async diskUsage(serial: string, dir: string, asRoot: boolean): Promise<DiskUsage> {
    const command = diskUsageCommand(dir)
    const out = asRoot
      ? await this.asRoot(serial, command, new Error(`${dir}: Permission denied`), DU_TIMEOUT)
      : await this.adb.shell(serial, command, { timeout: DU_TIMEOUT })
    return parseDiskUsage(dir, out, asRoot)
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

  private async pushOne(serial: string, local: string, target: string, report: (sent: number) => void, signal?: AbortSignal): Promise<void> {
    const info = await stat(local)
    if (info.isFile()) {
      try {
        await syncPush(this.adb.serverPort, serial, local, target, (sent) => report(sent), TRANSFER_TIMEOUT, signal)
      } catch (error) {
        // 取消或中途断开时设备上会留下写了一半的文件，删掉；权限错误时文件根本没建出来，不用管
        if (!isPermissionError((error as Error).message)) {
          await this.adb.shell(serial, `rm -f ${shellQuote(target)}`, { timeout: 10_000 }).catch(() => undefined)
        }
        throw error
      }
    } else {
      await this.adb.exec(['-s', serial, 'push', local, target], { timeout: TRANSFER_TIMEOUT, signal })
    }
  }

  /** 先以 shell 身份推到临时目录，再用 root 复制过去（cp 让文件取得目标目录的 SELinux 上下文） */
  private async pushViaRoot(
    serial: string,
    local: string,
    remoteDir: string,
    target: string,
    report: (sent: number) => void,
    cause?: Error,
    signal?: AbortSignal
  ): Promise<void> {
    const staging = remoteJoin(STAGING_DIR, `cockpit-${randomBytes(4).toString('hex')}-${basename(local)}`)
    await this.pushOne(serial, local, staging, report, signal)
    try {
      // 先复制成临时名再改名覆盖：替换正在运行的 APK（如 SystemUI）时旧文件仍被映射，不会先删掉再写
      const temp = `${target}.cockpit-tmp`
      const q = shellQuote
      await this.asRoot(
        serial,
        [
          `mkdir -p ${q(remoteDir)} && rm -rf ${q(temp)} && cp -r ${q(staging)} ${q(temp)} || { rm -rf ${q(temp)}; exit 1; }`,
          // 目录不能 mv 覆盖，先删掉旧的
          `if [ -d ${q(temp)} ] || [ -d ${q(target)} ]; then rm -rf ${q(target)}; fi`,
          `mv -f ${q(temp)} ${q(target)}`
        ].join('; '),
        cause ?? new Error(`${remoteDir}: Permission denied`),
        ROOT_COPY_TIMEOUT,
        signal
      )
    } finally {
      await this.adb.shell(serial, `rm -rf ${shellQuote(staging)}`).catch(() => undefined)
    }
  }

  private async pullViaRoot(serial: string, remotePath: string, localDir: string, cause: Error): Promise<string> {
    const stagingDir = remoteJoin(STAGING_DIR, `cockpit-${randomBytes(4).toString('hex')}`)
    const staged = remoteJoin(stagingDir, basename(remotePath.replace(/\/+$/, '')) || 'root')
    await this.asRoot(
      serial,
      `mkdir -p ${shellQuote(stagingDir)} && cp -r ${shellQuote(remotePath)} ${shellQuote(staged)} && chmod -R a+rX ${shellQuote(stagingDir)}`,
      cause
    )
    try {
      return await this.adb.exec(['-s', serial, 'pull', staged, localDir], { timeout: TRANSFER_TIMEOUT })
    } finally {
      await this.asRoot(serial, `rm -rf ${shellQuote(stagingDir)}`, cause).catch(() => undefined)
    }
  }

  /** 确保目录存在，返回 shell 身份能否写入；不能写时上传改走 root */
  private async prepareDir(serial: string, dir: string, signal?: AbortSignal): Promise<boolean> {
    const q = shellQuote(dir)
    const out = await this.adb.shell(serial, `mkdir -p ${q} 2>/dev/null; [ -d ${q} ] && [ -w ${q} ] && echo W; exit 0`, { signal })
    return out.trim() === 'W'
  }

  /** 以 root 执行；设备没有可用的 su 时抛出原来的权限错误并说明原因 */
  private async asRoot(serial: string, command: string, cause: Error, timeout = TRANSFER_TIMEOUT, signal?: AbortSignal): Promise<string> {
    const style = await this.suStyle(serial)
    if (style === 'none') throw new Error(`${cause.message}（设备没有可用的 su，无法提权访问）`)
    const wrapped = style === 'dash-c' ? `su -c ${shellQuote(command)}` : `su 0 sh -c ${shellQuote(command)}`
    return this.adb.shell(serial, wrapped, { timeout, signal })
  }

  /** 探测一次 su 的用法并缓存；失败的结果不缓存，用户在设备上授权后可以重试 */
  private suStyle(serial: string): Promise<SuStyle> {
    let cached = this.suStyles.get(serial)
    if (!cached) {
      cached = (async (): Promise<SuStyle> => {
        // 已是 root 的 adbd 直接执行即可
        const uid = await this.adb.shell(serial, 'id -u').catch(() => '')
        if (uid.trim() === '0') return 'none'
        const probe = async (cmd: string) => /uid=0\b/.test(await this.adb.shell(serial, cmd, { timeout: 20_000 }).catch(() => ''))
        if (await probe('su -c id')) return 'dash-c'
        if (await probe('su 0 id')) return 'uid'
        return 'none'
      })()
      this.suStyles.set(serial, cached)
      void cached.then((style) => style === 'none' && this.suStyles.delete(serial))
    }
    return cached
  }
}

/** system、vendor 等分区默认只读，给出处理办法 */
function explainWriteError(message: string): string {
  if (/read-only file system/i.test(message)) {
    return `${message}（该分区是只读的：需要先 adb root && adb disable-verity && adb remount，或在设备上 su 后 mount -o rw,remount 对应分区）`
  }
  return message
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop() ?? ''
}
