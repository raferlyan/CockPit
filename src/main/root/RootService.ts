import * as pty from 'node-pty'
import type { Device } from '@shared/models'
import type { RootMethod } from '@shared/root'
import type { AdbClient } from '../adb/AdbClient'
import { runDecryptTool } from './decryptTool'
import { RootSession } from './RootSession'
import type { RootSettingsStore } from './RootSettingsStore'
import { driveSu, SuError, type PtyLike, type SuOptions } from './suDriver'

/** adb root 后 adbd 重启，设备会短暂离线 */
const ADB_ROOT_WAIT = 30_000

/**
 * 按配置的方式让设备进入 root：
 * - adb root：重启 adbd 为 root，之后所有 adb 命令都是 root
 * - su / 密码 / 解密工具：在后台开一个常驻 `adb shell` 切到 root，文件传输、目录浏览、存储分析都经它执行
 * 同一台设备同一时间只有一个后台 root 会话。
 */
export class RootService {
  private readonly sessions = new Map<string, RootSession>()
  private readonly entering = new Map<string, Promise<RootMethod>>()

  constructor(
    private readonly adb: AdbClient,
    private readonly settings: RootSettingsStore,
    /** 后台 root 会话建立或结束时调用，method 为空表示已退出 */
    private readonly onChange: (serial: string, method: RootMethod | undefined) => void,
    /** adb root / unroot 之后重新探测设备的 root 状态 */
    private readonly refreshDevice: (serial: string) => void
  ) {}

  /** 可用的后台 root 会话 */
  session(serial: string): RootSession | undefined {
    const session = this.sessions.get(serial)
    return session?.alive ? session : undefined
  }

  enter(serial: string, method?: RootMethod): Promise<RootMethod> {
    const running = this.entering.get(serial)
    if (running) return running
    const task = this.doEnter(serial, method ?? this.settings.methodFor(serial)).finally(() => this.entering.delete(serial))
    this.entering.set(serial, task)
    return task
  }

  /** 退出后台 root 会话；adbd 是 root 时执行 adb unroot */
  async exit(serial: string): Promise<void> {
    const session = this.sessions.get(serial)
    if (session) {
      this.sessions.delete(serial)
      session.close()
      this.onChange(serial, undefined)
      return
    }
    if (await this.adbdIsRoot(serial)) {
      await this.adb.exec(['-s', serial, 'unroot'], { timeout: 20_000 })
      await this.adb.exec(['-s', serial, 'wait-for-device'], { timeout: ADB_ROOT_WAIT }).catch(() => undefined)
      this.refreshDevice(serial)
    }
  }

  /**
   * 打开 root 终端前调用。adb root 方式要先重启 adbd（会断开已有的 shell），
   * 返回 'ready' 表示新开的 shell 直接就是 root，'drive' 表示开好后还要在里面 su。
   */
  async prepareTerminal(serial: string): Promise<'ready' | 'drive'> {
    if (await this.adbdIsRoot(serial)) return 'ready'
    if (this.settings.methodFor(serial) === 'adb-root') {
      await this.enter(serial, 'adb-root')
      return 'ready'
    }
    return 'drive'
  }

  /** 在已打开的终端里按设备配置的方式 su */
  elevate(serial: string, io: PtyLike): Promise<void> {
    const method = this.settings.methodFor(serial)
    return driveSu(io, this.suOptions(method === 'adb-root' ? 'su' : method))
  }

  onDevicesChanged(devices: Device[]): void {
    const online = new Set(devices.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const [serial, session] of this.sessions) {
      if (!online.has(serial)) {
        this.sessions.delete(serial)
        session.close()
        this.onChange(serial, undefined)
      }
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
  }

  private async doEnter(serial: string, method: RootMethod): Promise<RootMethod> {
    if (method === 'adb-root') {
      await this.adbRoot(serial)
      return method
    }
    this.sessions.get(serial)?.close()
    this.sessions.delete(serial)

    const proc = pty.spawn(this.adb.adbPath, ['-s', serial, 'shell'], {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: process.env.HOME ?? process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
    })
    const listeners = new Set<(data: string) => void>()
    proc.onData((data) => listeners.forEach((l) => l(data)))
    const io = {
      write: (data: string) => proc.write(data),
      onData: (listener: (data: string) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      kill: () => proc.kill()
    }
    let exited = false
    let session: RootSession | undefined
    let output = ''
    const collect = io.onData((d) => (output = (output + d).slice(-2000)))
    const exit = new Promise<never>((_resolve, reject) => {
      proc.onExit(() => {
        exited = true
        if (session && this.sessions.get(serial) === session) {
          this.sessions.delete(serial)
          session.markClosed()
          this.onChange(serial, undefined)
        }
        reject(new SuError('adb shell 已退出', output))
      })
    })
    exit.catch(() => undefined)

    try {
      await Promise.race([driveSu(io, this.suOptions(method)), exit])
      session = new RootSession(io, method)
      await Promise.race([session.init(), exit])
    } catch (error) {
      if (!exited) proc.kill()
      throw error
    } finally {
      collect()
    }
    this.sessions.set(serial, session)
    this.onChange(serial, method)
    return method
  }

  private suOptions(method: Exclude<RootMethod, 'adb-root'>): SuOptions {
    const settings = this.settings.get()
    return {
      method,
      suCommand: settings.suCommand,
      user: settings.passwordUser,
      password: this.settings.password(),
      decrypt: (challenge) => runDecryptTool(this.settings.get(), challenge),
      challengePattern: settings.challengePattern
    }
  }

  private async adbRoot(serial: string): Promise<void> {
    const out = await this.adb.exec(['-s', serial, 'root'], { timeout: 20_000 }).catch((error: Error) => error.message)
    if (/cannot run as root|production builds|not allowed/i.test(out)) {
      throw new Error('该设备不支持 adb root（user 版本的 adbd 不能以 root 运行）：请改用 su、密码或解密工具')
    }
    await this.adb.exec(['-s', serial, 'wait-for-device'], { timeout: ADB_ROOT_WAIT })
    // adbd 重启后要等一会儿才接受 shell
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await this.adbdIsRoot(serial)) {
        this.refreshDevice(serial)
        return
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`adb root 之后 adbd 仍不是 root：${out.trim()}`)
  }

  private async adbdIsRoot(serial: string): Promise<boolean> {
    return (await this.adb.shell(serial, 'id -u', { timeout: 5_000 }).catch(() => '')).trim() === '0'
  }
}
