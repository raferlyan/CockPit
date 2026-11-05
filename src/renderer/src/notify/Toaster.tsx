import { useEffect } from 'react'
import { api } from '../api'
import { errorMessage, notify, useNotifyStore } from './notifyStore'
import { t as tr } from '../i18n'
import { Exit } from '../motion/Exit'

const ICON = { info: 'i', success: '✓', warn: '!', error: '×' }

export function Toaster() {
  const { toasts, dismiss } = useNotifyStore()
  return (
    <div className="toaster" role="status" aria-live="polite">
      {/* Exit：关闭时收起高度并淡出，下面的通知平滑补上 */}
      {toasts.map((t) => (
        <Exit key={t.id}>
          <div className={`toast toast-${t.level}`}>
            <span className="toast-icon" aria-hidden>
              {ICON[t.level]}
            </span>
            <div className="toast-text">
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            <button className="toast-close" title={tr('关闭')} onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        </Exit>
      ))}
    </div>
  )
}

/** 兜底：没人处理的 Promise 失败、脚本异常、主进程异常，都弹提示而不是静默 */
export function useGlobalErrorToasts(): void {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => notify('error', tr('操作失败'), errorMessage(event.reason))
    const onError = (event: ErrorEvent) => {
      // ResizeObserver 的循环警告无害，浏览器会把它当错误抛出
      if (/ResizeObserver loop/.test(event.message)) return
      notify('error', tr('界面出错'), event.message)
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    const offMain = api.app.onError((message) => notify('error', tr('后台出错'), message))
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
      offMain()
    }
  }, [])
}
