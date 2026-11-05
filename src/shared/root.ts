/**
 * 进入 root 的方式：
 * - su：免密 su（Magisk、KernelSU、userdebug 自带的 su）
 * - adb-root：`adb root`，让 adbd 以 root 运行（userdebug / eng 版本）
 * - password：su 后提示输入密码，用保存的用户名和密码
 * - challenge：su 后给出一串挑战码，交给本机的解密工具算出密码
 */
export type RootMethod = 'su' | 'adb-root' | 'password' | 'challenge'

export const ROOT_METHODS: RootMethod[] = ['su', 'adb-root', 'password', 'challenge']

/** 渲染进程看到的 root 设置；密码只告诉有没有保存，不回传明文 */
export interface RootSettings {
  defaultMethod: RootMethod
  /** 各设备单独指定的方式，没有的跟随默认 */
  deviceMethods: Record<string, RootMethod>
  /** su 命令，个别设备是 /system/xbin/su 之类的路径 */
  suCommand: string
  /** password 方式：su 的目标用户，空表示 root（直接 `su`） */
  passwordUser: string
  hasPassword: boolean
  /** challenge 方式：本机解密工具的路径（Windows 上通常是 .exe） */
  toolPath: string
  /** 传给解密工具的参数，{challenge} 换成挑战码；为空时不传参数 */
  toolArgs: string
  /** 同时把挑战码写到解密工具的标准输入 */
  toolStdin: boolean
  /** 从 su 输出里提取挑战码的正则，有捕获组时取第一组；为空时自动识别 */
  challengePattern: string
}

/** password 为空字符串表示清除已保存的密码，undefined 表示不改 */
export type RootSettingsUpdate = Partial<Omit<RootSettings, 'hasPassword'>> & { password?: string }

/** 测试解密工具用到的设置 */
export type DecryptToolConfig = Pick<RootSettings, 'toolPath' | 'toolArgs' | 'toolStdin'>
