import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, clipboard, ClipboardItem } from 'electron'
import type { AppAction, AppPackage, InstallResult } from '@shared/apps'
import type { AdbClient } from '../adb/AdbClient'
import { parsePackageList } from './packages'

const SEP = '__COCKPIT_SEP__'
const INSTALL_TIMEOUT = 10 * 60_000

/** 包名只允许这些字符，拼进 shell 命令前校验 */
const PACKAGE_NAME = /^[A-Za-z0-9_.]+$/

/** 应用扫描、安装卸载与截图，都是一次性 adb 调用 */
export class AppService {
  constructor(private readonly adb: AdbClient) {}

  /** 全量扫描：含系统应用和对当前用户已卸载的系统应用 */
  async list(serial: string): Promise<AppPackage[]> {
    const out = await this.adb.shell(
      serial,
      ['pm list packages -u', `echo ${SEP}`, 'pm list packages -f', `echo ${SEP}`, 'pm list packages -3', `echo ${SEP}`, 'pm list packages -d'].join('; '),
      { timeout: 60_000 }
    )
    const [all = '', installed = '', third = '', disabled = ''] = out.split(SEP)
    return parsePackageList({ all, installed, third, disabled })
  }

  async run(serial: string, pkg: string, action: AppAction, kind: AppPackage['kind']): Promise<string> {
    if (!PACKAGE_NAME.test(pkg)) throw new Error(`包名不合法：${pkg}`)
    const command: Record<AppAction, string> = {
      // 系统应用只能对当前用户卸载，数据和 APK 仍在，可随时恢复
      uninstall: kind === 'system' ? `pm uninstall --user 0 ${pkg}` : `pm uninstall ${pkg}`,
      restore: `cmd package install-existing ${pkg}`,
      disable: `pm disable-user --user 0 ${pkg}`,
      enable: `pm enable ${pkg}`,
      forceStop: `am force-stop ${pkg}`,
      clearData: `pm clear ${pkg}`
    }
    const out = (await this.adb.shell(serial, `${command[action]} 2>&1`, { timeout: 60_000 })).trim()
    // pm 失败时多数仍返回 0，靠输出判断
    if (/Failure|Error|Exception|not installed|Unknown package/i.test(out)) throw new Error(out)
    return out
  }

  /** 把 base.apk 下载到本机目录，文件名用包名 */
  async exportApk(serial: string, pkg: string, apkPath: string, localDir: string): Promise<string> {
    if (!PACKAGE_NAME.test(pkg)) throw new Error(`包名不合法：${pkg}`)
    const target = join(localDir, `${pkg}.apk`)
    await this.adb.exec(['-s', serial, 'pull', apkPath, target], { timeout: INSTALL_TIMEOUT })
    return target
  }

  /** 逐个安装，覆盖安装并允许测试包；单个失败不影响其它 */
  async install(serial: string, apkPaths: string[]): Promise<InstallResult[]> {
    const results: InstallResult[] = []
    for (const path of apkPaths) {
      try {
        const out = await this.adb.exec(['-s', serial, 'install', '-r', '-t', path], { timeout: INSTALL_TIMEOUT })
        const failure = out.match(/Failure \[[^\]]+\]/)
        results.push(failure ? { path, ok: false, message: failure[0] } : { path, ok: true, message: basename(path) })
      } catch (error) {
        const message = (error as Error).message
        results.push({ path, ok: false, message: message.match(/Failure \[[^\]]+\]/)?.[0] ?? message })
      }
    }
    return results
  }

  /** 原始分辨率截图：保存到「图片/Cockpit」并复制到剪贴板，返回文件路径 */
  async screenshot(serial: string, label: string): Promise<string> {
    const png = await this.adb.execBuffer(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 20_000 })
    if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('设备没有返回 PNG 图像（可能处于锁屏安全界面或不支持 screencap）')
    const dir = join(app.getPath('pictures'), 'Cockpit')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)
    const file = join(dir, `${label.replace(/[^\w.-]+/g, '_')}_${stamp}.png`)
    await writeFile(file, png)
    // 复制失败不影响截图本身
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]).catch((error) => console.warn('[screenshot] 复制到剪贴板失败', error))
    return file
  }
}
