import type { WebContents } from 'electron'

/**
 * 会话属于发起它的页面。页面消失时调用 onGone：窗口关闭、渲染进程崩溃，
 * 以及主框架导航（包括刷新）——刷新不会销毁 WebContents，旧页面的会话却已无人接收。
 * 返回取消函数，会话自行结束时调用，避免监听器在同一个 WebContents 上越积越多。
 */
export function watchOwner(owner: WebContents, onGone: () => void): () => void {
  let done = false
  const fire = () => {
    if (done) return
    done = true
    dispose()
    onGone()
  }
  const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) fire()
  }
  owner.once('destroyed', fire)
  owner.on('render-process-gone', fire)
  owner.on('did-start-navigation', onNavigate)
  const dispose = () => {
    done = true
    owner.removeListener('destroyed', fire)
    owner.removeListener('render-process-gone', fire)
    owner.removeListener('did-start-navigation', onNavigate)
  }
  return dispose
}
