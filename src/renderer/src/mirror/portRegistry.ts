import { MIRROR_PORT_MESSAGE } from '@shared/ipc'

/*
 * 收集 preload 转交过来的视频 MessagePort。
 * 端口可能先于 mirror.start() 的返回值到达，所以模块加载时就开始监听。
 */

const ports = new Map<string, MessagePort>()
const waiters = new Map<string, (port: MessagePort) => void>()

window.addEventListener('message', (event) => {
  const data = event.data as { type?: string; sessionId?: string }
  if (data?.type !== MIRROR_PORT_MESSAGE || !data.sessionId) return
  const port = event.ports[0]
  if (!port) return
  const waiter = waiters.get(data.sessionId)
  if (waiter) {
    waiters.delete(data.sessionId)
    waiter(port)
  } else {
    ports.set(data.sessionId, port)
  }
})

export function takeMirrorPort(sessionId: string, timeoutMs = 5_000): Promise<MessagePort> {
  const port = ports.get(sessionId)
  if (port) {
    ports.delete(sessionId)
    return Promise.resolve(port)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(sessionId)
      reject(new Error('未收到视频通道'))
    }, timeoutMs)
    waiters.set(sessionId, (p) => {
      clearTimeout(timer)
      resolve(p)
    })
  })
}

/** 会话结束或启动失败时丢弃尚未取走的端口 */
export function discardMirrorPort(sessionId: string): void {
  ports.get(sessionId)?.close()
  ports.delete(sessionId)
  waiters.delete(sessionId)
}
