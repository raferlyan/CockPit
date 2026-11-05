import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** 退场动画最长时间，超过就直接移除，防止动画事件丢失时残留 */
const MAX_EXIT_MS = 400

/**
 * 给条件渲染的元素加上退场动画。
 *
 * 被包住的组件卸载时（如对话框关闭），它依赖的状态往往已经清空、没法再渲染一帧，
 * 所以这里在卸载前把 DOM 克隆一份留在原位置，加上 is-leaving 让 CSS 播放退场动画，播完再移除。
 * 克隆体不响应鼠标和键盘，原组件的状态、事件、定时器都正常销毁。
 *
 * 包裹层是 display: contents 的 div，不影响布局；动画写在 styles.css 的 .is-leaving 规则里。
 */
export function Exit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const wrapper = ref.current
    return () => {
      // React 先执行这里的清理，再把节点从 DOM 中移除，此时还能拿到完整的 DOM
      const parent = wrapper?.parentNode
      if (!wrapper || !parent || !document.contains(wrapper)) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const ghost = wrapper.cloneNode(true) as HTMLElement
      ghost.classList.add('is-leaving')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.inert = true
      // 克隆不会带上画布内容，把截图等画布的当前画面复制过去
      const sources = wrapper.querySelectorAll('canvas')
      ghost.querySelectorAll('canvas').forEach((canvas, i) => {
        try {
          canvas.getContext('2d')?.drawImage(sources[i], 0, 0)
        } catch {
          // 画布被占用或跨域时保持空白，不影响退场
        }
      })
      parent.insertBefore(ghost, wrapper.nextSibling)
      let removed = false
      const remove = () => {
        if (removed) return
        removed = true
        ghost.remove()
      }
      // 只认克隆体自身及第一层子元素的动画结束，内部元素的动画不算
      ghost.addEventListener('animationend', (e) => {
        const target = e.target as HTMLElement
        if (target === ghost || target.parentElement === ghost || target.parentElement?.parentElement === ghost) remove()
      })
      setTimeout(remove, MAX_EXIT_MS)
    }
  }, [])

  return (
    <div ref={ref} className="exit-wrap">
      {children}
    </div>
  )
}
