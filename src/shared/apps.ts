/** 设备上的一个应用包 */
export interface AppPackage {
  name: string
  /** user：用户安装；system：系统预装 */
  kind: 'user' | 'system'
  /** 已被 `pm disable-user` 停用 */
  disabled: boolean
  /** 系统应用对当前用户卸载后仍留在系统分区，可用 install-existing 恢复 */
  uninstalled: boolean
  /** base.apk 路径，已卸载的为空 */
  apkPath?: string
}

export type AppAction = 'uninstall' | 'restore' | 'disable' | 'enable' | 'forceStop' | 'clearData'

/** 一个 APK 的安装结果 */
export interface InstallResult {
  path: string
  ok: boolean
  message: string
}
