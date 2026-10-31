import type { ButtonHTMLAttributes } from 'react'
import { notify } from './notifyStore'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  /** 不可用的原因；有值时按钮显示为禁用，点击会提示原因而不是毫无反应 */
  disabledReason?: string | false | null
}

/**
 * 原生 disabled 按钮点了什么也不会发生，用户分不清是坏了还是不可用。
 * 这里用 aria-disabled 代替：外观一样，点击时说明为什么不能用。
 */
export function ActionButton({ disabledReason, onClick, className, ...rest }: Props) {
  const disabled = Boolean(disabledReason)
  return (
    <button
      {...rest}
      className={`${className ?? ''}${disabled ? ' is-disabled' : ''}`}
      aria-disabled={disabled || undefined}
      title={disabled ? (disabledReason as string) : rest.title}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault()
          notify('info', disabledReason as string)
          return
        }
        onClick?.(event)
      }}
    />
  )
}
