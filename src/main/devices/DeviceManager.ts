import { EventEmitter } from 'node:events'
import type { AdbStatus, Device } from '@shared/models'
import type { RootMethod } from '@shared/root'
import type { AdbClient } from '../adb/AdbClient'
import type { ListedDevice } from '../adb/protocol'
import { DEVICE_INFO_COMMAND, parseDeviceInfoOutput } from './deviceInfo'

const RETRY_MIN = 1_000
const RETRY_MAX = 15_000

interface DeviceManagerEvents {
  devices: [Device[]]
  status: [AdbStatus]
}

/**
 * 维护设备列表：
 * - 通过 adb server 的 track-devices 实时感知上下线
 * - 设备进入 `device` 状态后异步拉取型号、系统版本、root 粗略状态
 * - adb server 断开（被 kill、重启）时自动拉起并重连
 */
export class DeviceManager extends EventEmitter<DeviceManagerEvents> {
  private readonly devices = new Map<string, Device>()
  private stopTracking?: () => void
  private retryTimer?: NodeJS.Timeout
  private retryDelay = RETRY_MIN
  private disposed = false
  private status: AdbStatus

  constructor(
    private readonly adb: AdbClient,
    version?: string
  ) {
    super()
    this.status = { path: adb.adbPath, version, tracking: false }
  }

  list(): Device[] {
    return [...this.devices.values()].sort((a, b) => a.serial.localeCompare(b.serial))
  }

  getStatus(): AdbStatus {
    return this.status
  }

  async start(): Promise<void> {
    await this.track()
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.retryTimer)
    this.stopTracking?.()
  }

  /** 后台 root 会话建立或结束时调用 */
  setRootSession(serial: string, method: RootMethod | undefined): void {
    const device = this.devices.get(serial)
    if (!device || device.rootSession === method) return
    this.devices.set(serial, { ...device, rootSession: method })
    this.emitDevices()
  }

  /** 终端身份变化时调用：该设备有任一终端处于 root 身份就标记 shellRoot */
  setShellRoot(serial: string, shellRoot: boolean): void {
    const device = this.devices.get(serial)
    if (!device || Boolean(device.shellRoot) === shellRoot) return
    this.devices.set(serial, { ...device, shellRoot })
    this.emitDevices()
  }

  async refreshInfo(serial: string): Promise<void> {
    const device = this.devices.get(serial)
    if (device?.state === 'device') await this.loadInfo(serial)
  }

  private async track(): Promise<void> {
    try {
      // track-devices 要求 server 已在运行；start-server 在已运行时是空操作
      await this.adb.startServer()
    } catch (error) {
      this.setStatus({ tracking: false, error: (error as Error).message })
      this.scheduleRetry()
      return
    }
    if (this.disposed) return

    this.stopTracking = this.adb.trackDevices({
      onDevices: (listed) => {
        this.retryDelay = RETRY_MIN
        if (!this.status.tracking || this.status.error) this.setStatus({ tracking: true, error: undefined })
        this.applyList(listed)
      },
      onClose: (error) => {
        this.setStatus({ tracking: false, error: error?.message ?? 'adb server 连接已断开' })
        this.scheduleRetry()
      }
    })
  }

  private scheduleRetry(): void {
    if (this.disposed) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.track(), this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX)
  }

  private applyList(listed: ListedDevice[]): void {
    const seen = new Set<string>()
    for (const item of listed) {
      seen.add(item.serial)
      const previous = this.devices.get(item.serial)
      const becameReady = item.state === 'device' && previous?.state !== 'device'
      // 设备不再可用时清掉旧信息，重新上线后重新拉取
      const keepInfo = item.state === 'device' && previous?.state === 'device'
      this.devices.set(item.serial, {
        ...item,
        info: keepInfo ? previous?.info : undefined,
        root: keepInfo ? (previous?.root ?? 'unknown') : 'unknown',
        shellRoot: keepInfo ? previous?.shellRoot : undefined,
        rootSession: keepInfo ? previous?.rootSession : undefined,
        infoError: keepInfo ? previous?.infoError : undefined
      })
      if (becameReady) void this.loadInfo(item.serial)
    }
    for (const serial of this.devices.keys()) {
      if (!seen.has(serial)) this.devices.delete(serial)
    }
    this.emitDevices()
  }

  private async loadInfo(serial: string): Promise<void> {
    try {
      const output = await this.adb.shell(serial, DEVICE_INFO_COMMAND)
      const { info, root } = parseDeviceInfoOutput(output)
      this.update(serial, { info, root, infoError: undefined })
    } catch (error) {
      this.update(serial, { infoError: (error as Error).message })
    }
  }

  private update(serial: string, patch: Partial<Device>): void {
    const device = this.devices.get(serial)
    // 拉取期间设备可能已断开
    if (!device || device.state !== 'device') return
    this.devices.set(serial, { ...device, ...patch })
    this.emitDevices()
  }

  private emitDevices(): void {
    this.emit('devices', this.list())
  }

  private setStatus(patch: Partial<AdbStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }
}
