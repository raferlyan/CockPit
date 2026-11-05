import type { RootMethod } from '@shared/root'
import { api } from '../api'
import { errorMessage, notify, updateToast } from '../notify/notifyStore'
import { t } from '../i18n'

export const METHOD_LABEL = (): Record<RootMethod, string> => ({
  su: t('su（免密）'),
  'adb-root': 'adb root',
  password: t('用户名 + 密码'),
  challenge: t('解密工具')
})

export const METHOD_DESC = (): Record<RootMethod, string> => ({
  su: t('Magisk、KernelSU 或 userdebug 自带的 su，执行 su 直接得到 root'),
  'adb-root': t('userdebug / eng 版本：让 adbd 以 root 运行，之后所有 adb 命令都是 root'),
  password: t('su 后提示输入密码，自动填入保存的密码'),
  challenge: t('su 后给出一串挑战码，交给本机的解密工具算出密码再填入')
})

/** 进入 root，全程用同一条通知显示进度和结果 */
export async function enterRoot(serial: string, label: string, method?: RootMethod): Promise<boolean> {
  const toast = notify('info', t('正在让 {name} 进入 root…', { name: label }), method ? METHOD_LABEL()[method] : undefined)
  try {
    const used = await api.root.enter(serial, method)
    updateToast(toast, 'success', t('{name} 已进入 root', { name: label }), METHOD_LABEL()[used])
    return true
  } catch (error) {
    updateToast(toast, 'error', t('{name} 进入 root 失败', { name: label }), errorMessage(error))
    return false
  }
}

export async function exitRoot(serial: string, label: string): Promise<void> {
  try {
    await api.root.exit(serial)
    notify('info', t('{name} 已退出 root', { name: label }))
  } catch (error) {
    notify('error', t('退出 root 失败'), errorMessage(error))
  }
}
