import { Component, type ReactNode } from 'react'
import { notify } from './notifyStore'

interface Props {
  /** 区域名，显示在出错提示里 */
  name: string
  className?: string
  children: ReactNode
}

/** 某个面板渲染崩溃时只替换该面板，其它区域照常可用 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    notify('error', `${this.props.name}出错`, error.message)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className={`crash ${this.props.className ?? ''}`}>
        <p>{this.props.name}出错了</p>
        <p className="mono muted">{this.state.error.message}</p>
        <button className="secondary" onClick={() => this.setState({ error: null })}>
          重新加载此区域
        </button>
      </section>
    )
  }
}
