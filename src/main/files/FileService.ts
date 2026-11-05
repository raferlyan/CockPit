import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DiskUsage, RemoteEntry, TransferPhase, TransferProgress, TransferResult } from '@shared/files'
import type { AdbClient } from '../adb/AdbClient'
import { syncPush } from '../adb/sync'
import {
  diskUsageCommand,
  isPermissionError,
  listCommand,
  parseDiskUsage,
  parseLsOutput,
  parseTargetProbe,
  remoteJoin,
  shellQuote,
  targetProbeCommand,
  type TargetProbe
} from './remotePath'

/** 大文件走 USB 2.0 也可能要几分钟，给足时间 */
const TRANSFER_TIMEOUT = 30 * 60_000
/** root 复制已在设备上的文件，正常几秒内完成；su 授权弹窗没人点时不至于一直等 */
const ROOT_COPY_TIMEOUT = 2 * 60_000
/** /data 这种文件多的分区 du 要跑很久 */
const DU_TIMEOUT = 3 * 60_000
/** root 中转用的临时目录，shell 用户可读写 */
const STAGING_DIR = '/data/local/tmp'

/**
 * 怎样拿到 root：adbd 本身是 root（adb root）时直接执行；
 * 否则用 su，Magisk / KernelSU 是 `su -c`，AOSP userdebug 是 `su 0 sh -c`。
 */
export type RootAccess = 'adbd' | 'session' | 'dash-c' | 'uid' | 'none'

/** 后台 root 会话（设备列表右键「进入 root」建立），能用时优先经它执行 */
export interface RootChannel {
  exec(command: string, timeout?: number): Promise<string>
}

/** 上传前检查目标目录，su 授权弹窗可能要等用户点 */
const PROBE_TIMEOUT = 20_000

/**
 * 本机与设备之间的文件传输。
 * 每次调用都是独立的 adb 连接，不继承终端里 su 之后的身份；
 * 普通身份遇到权限问题时，若设备可以 su，就自动经 /data/local/tmp 用 root 中转。
 */
export class FileService {
  private readonly rootAccesses = new Map<string, Promise<RootAccess>>()

  constructor(
    private readonly adb: AdbClient,
    private readonly rootChannel: (serial: string) => RootChannel | undefined = () => undefined
  ) {}

  /** 列出设备目录，目录排在前面；无权限时尝试 root */
  async list(serial: string, dir: string): Promise<RemoteEntry[]> {
    const command = listCommand(dir)
    try {
      return parseLsOutput(await this.adb.shell(serial, command, { timeout: 15_000, note: '列出目录内容' }))
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
   * 发送数据前先检查目标：分区只读、没有权限又没有 root 时直接说明原因，不白传一遍。
   * 普通文件走 sync 协议并回报字节进度；目录交给 `adb push`，只回报开始和结束。
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
    let index = 0
    let done = 0
    /** fileSent 为负数表示当前文件已全部发出 */
    const emit = (phase: TransferPhase, fileSent = 0) =>
      onProgress?.({
        phase,
        index,
        count: localPaths.length,
        name: basename(localPaths[index] ?? ''),
        fileSent: fileSent < 0 ? sizes[index] : fileSent,
        fileTotal: sizes[index] ?? 0,
        sent: done + (fileSent < 0 ? sizes[index] : fileSent),
        total
      })

    emit('check')
    let blocked: string | null = null
    /** 分区只读但拿得到 root 时，界面可以提供一键 remount */
    let remountPoint: string | undefined
    let viaRoot = false
    try {
      const probe = parseTargetProbe(
        await this.adb.shell(serial, targetProbeCommand(remoteDir), { timeout: PROBE_TIMEOUT, signal, note: '上传前检查：目录能否写入、所在分区是否只读、adbd 身份' })
      )
      if (!probe.writable) {
        emit('root')
        const access = await this.rootAccess(serial, signal)
        signal?.throwIfAborted()
        blocked = explainBlockedTarget(remoteDir, probe, access)
        if (blocked && access !== 'none' && isReadOnly(probe)) remountPoint = probe.mount?.point ?? '/'
        viaRoot = !blocked && access !== 'adbd'
      }
    } catch (error) {
      blocked = signal?.aborted ? '已取消' : `检查目标目录失败：${(error as Error).message}`
    }
    if (blocked) {
      const reason = blocked
      return localPaths.map((local) => ({ source: local, target: remoteJoin(remoteDir, basename(local)), ok: false, message: reason, remount: remountPoint }))
    }

    const results: TransferResult[] = []
    for (const [i, local] of localPaths.entries()) {
      index = i
      const name = basename(local)
      const target = remoteJoin(remoteDir, name)
      if (signal?.aborted) {
        results.push({ source: local, target, ok: false, message: '已取消' })
        continue
      }
      const report = (fileSent: number, phase: TransferPhase = 'send') => emit(phase, fileSent)
      try {
        if (viaRoot) await this.pushViaRoot(serial, local, remoteDir, target, report, undefined, signal)
        else {
          try {
            await this.pushOne(serial, local, target, report, signal)
          } catch (error) {
            // 目录可写但同名文件属于别的用户等情况
            if (!isPermissionError((error as Error).message)) throw error
            await this.pushViaRoot(serial, local, remoteDir, target, report, error as Error, signal)
          }
        }
        results.push({ source: local, target, ok: true, message: viaRoot ? '已通过 root 写入' : '' })
      } catch (error) {
        results.push({ source: local, target, ok: false, message: signal?.aborted ? '已取消' : explainWriteError((error as Error).message) })
      }
      report(-1)
      done += sizes[i]
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
      : await this.adb.shell(serial, command, { timeout: DU_TIMEOUT, note: '统计各子项占用' })
    return parseDiskUsage(dir, out, asRoot)
  }

  /**
   * 把只读分区重新挂载为可写。adbd 是 root 时用 `adb remount`（会处理 overlayfs），
   * 否则经 root 执行 `mount -o rw,remount`。返回给用户看的结果说明。
   */
  async remount(serial: string, point: string): Promise<string> {
    const access = await this.rootAccess(serial)
    if (access === 'none') throw new Error(`无法 remount：${NO_ROOT}`)
    if (access === 'adbd') {
      const out = await this.adb.exec(['-s', serial, 'remount'], { timeout: 60_000 }).catch((error: Error) => {
        throw new Error(explainRemountError(error.message))
      })
      if (/reboot/i.test(out)) throw new Error(`adb remount 要求重启设备后才生效：请重启设备，再执行 adb root 后重试上传（adb 输出：${lastLine(out)}）`)
      return lastLine(out) || 'remount succeeded'
    }
    const q = shellQuote(point)
    await this.asRoot(serial, `mount -o rw,remount ${q} || mount -o remount,rw ${q}`, new Error(`${point}: Permission denied`), 30_000).catch((error: Error) => {
      throw new Error(explainRemountError(error.message))
    })
    return `${point} 已重新挂载为可写`
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
    report(0)
    if (info.isFile()) {
      try {
        await syncPush(this.adb.serverPort, serial, local, target, (sent) => report(sent), TRANSFER_TIMEOUT, signal)
      } catch (error) {
        // 取消或中途断开时设备上会留下写了一半的文件，删掉；权限错误时文件根本没建出来，不用管
        if (!isPermissionError((error as Error).message)) {
          await this.adb.shell(serial, `rm -f ${shellQuote(target)}`, { timeout: 10_000, note: '删除传了一半的文件' }).catch(() => undefined)
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
    report: (sent: number, phase?: TransferPhase) => void,
    cause?: Error,
    signal?: AbortSignal
  ): Promise<void> {
    // 先确认能拿到 root 再传，免得传完才发现没法复制过去
    if ((await this.rootAccess(serial, signal)) === 'none') {
      throw new Error(cause ? `${cause.message}（${NO_ROOT}）` : `没有写入 ${remoteDir} 的权限，${NO_ROOT}`)
    }
    const staging = remoteJoin(STAGING_DIR, `cockpit-${randomBytes(4).toString('hex')}-${basename(local)}`)
    await this.pushOne(serial, local, staging, report, signal)
    report(-1, 'root-copy')
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
      ).catch((error: Error) => {
        if (/timed out/i.test(error.message)) {
          throw new Error(`用 root 写入目标位置 ${ROOT_COPY_TIMEOUT / 60_000} 分钟仍未完成（可能在等设备上的 su 授权）`)
        }
        throw error
      })
    } finally {
      await this.adb.shell(serial, `rm -rf ${shellQuote(staging)}`, { note: '清理临时文件' }).catch(() => undefined)
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

  /** 以 root 执行；设备拿不到 root 时抛出原来的权限错误并说明原因 */
  private async asRoot(serial: string, command: string, cause: Error, timeout = TRANSFER_TIMEOUT, signal?: AbortSignal): Promise<string> {
    const access = await this.rootAccess(serial, signal)
    if (access === 'none') throw new Error(`${cause.message}（${NO_ROOT}）`)
    if (access === 'session') {
      signal?.throwIfAborted()
      return this.rootChannel(serial)!.exec(command, timeout)
    }
    const wrapped = access === 'adbd' ? command : access === 'dash-c' ? `su -c ${shellQuote(command)}` : `su 0 sh -c ${shellQuote(command)}`
    return this.adb.shell(serial, wrapped, { timeout, signal, note: access === 'adbd' ? undefined : '以 root 执行' })
  }

  /** 探测一次怎样拿 root 并缓存；拿不到的结果不缓存，用户在设备上授权或 adb root 后可以重试 */
  private rootAccess(serial: string, signal?: AbortSignal): Promise<RootAccess> {
    if (this.rootChannel(serial)) return Promise.resolve('session')
    let cached = this.rootAccesses.get(serial)
    if (!cached) {
      cached = (async (): Promise<RootAccess> => {
        const uid = await this.adb.shell(serial, 'id -u', { signal, note: '检查 adbd 是否为 root' }).catch(() => '')
        if (uid.trim() === '0') return 'adbd'
        const probe = async (cmd: string) =>
          /uid=0\b/.test(await this.adb.shell(serial, cmd, { timeout: PROBE_TIMEOUT, signal, note: '检查能否免密 su' }).catch(() => ''))
        if (await probe('su -c id')) return 'dash-c'
        if (await probe('su 0 id')) return 'uid'
        return 'none'
      })()
      this.rootAccesses.set(serial, cached)
      void cached.then((access) => access === 'none' && this.rootAccesses.delete(serial))
    }
    return cached
  }
}

const NO_ROOT = '拿不到 root：adbd 不是 root，su 不能免密使用，也还没有在左侧设备列表右键「进入 root」'

function isReadOnly(probe: TargetProbe): boolean {
  return Boolean(probe.mount?.readOnly) || /read-only file system/i.test(probe.mkdirError)
}

/** remount 失败多半是 verity / 动态分区挡住了 */
function explainRemountError(message: string): string {
  if (/verity|dm-|busy|permission denied|not permitted|invalid argument/i.test(message)) {
    return `remount 失败：${message}（这台设备的分区受 verity 或动态分区保护，单纯 mount 改不了，需要 adb root && adb disable-verity，重启后再 adb root && adb remount）`
  }
  return `remount 失败：${message}`
}

/**
 * 根据上传前的检查结果说明为什么写不进去；能通过 root 写入时返回 null。
 * 区分“分区只读，需要 remount”和“没有权限，需要 root”，并按设备的 root 情况给出具体办法。
 */
export function explainBlockedTarget(dir: string, probe: TargetProbe, access: RootAccess): string | null {
  if (isReadOnly(probe)) {
    const point = probe.mount?.point ?? dir
    const head = `目标目录 ${dir} 所在的分区 ${point} 是只读挂载的，`
    if (access === 'adbd') {
      return `${head}adbd 已是 root，但该分区还没有 remount。请执行 adb remount；如果提示需要关闭 verity，先执行 adb disable-verity 并重启设备，再执行 adb root && adb remount`
    }
    if (access === 'session') {
      return `${head}已经进入 root，但该分区还没有 remount。可以点「remount 后重试」，或在 root 终端里执行 mount -o rw,remount ${point}`
    }
    if (access !== 'none') {
      return `${head}设备已 root（su 可用），但该分区还没有 remount。可以点「remount 后重试」，或在终端里 su 后执行 mount -o rw,remount ${point}；开启了 verity 的设备需要先 adb root && adb disable-verity && adb remount`
    }
    return `${head}而且${NO_ROOT}，无法写入。userdebug / eng 版本可以先执行 adb root && adb remount；user 版本需要先 root 设备`
  }
  if (access === 'none') {
    if (!probe.exists && probe.mkdirError && !isPermissionError(probe.mkdirError)) return `无法创建目录 ${dir}：${probe.mkdirError}`
    return `没有写入 ${dir} 的权限，而且${NO_ROOT}。可以改传到 /sdcard 或 /data/local/tmp`
  }
  return null
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
