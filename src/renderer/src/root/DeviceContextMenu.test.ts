import { describe, expect, it } from 'vitest'
import { isOutsideDeviceMenu } from './deviceMenuDismiss'

describe('device context menu dismissal', () => {
  it('treats a target outside the portaled menu as dismissing', () => {
    const inside = {} as Node
    const outside = {} as Node
    const menu = { contains: (target: Node | null) => target === inside } as Pick<HTMLElement, 'contains'>

    expect(isOutsideDeviceMenu(menu, outside)).toBe(true)
    expect(isOutsideDeviceMenu(menu, inside)).toBe(false)
  })
})
