/** Portal 菜单要在捕获阶段判断命中区域，避免画布 preventDefault 后不再产生 mousedown。 */
export function isOutsideDeviceMenu(menu: Pick<HTMLElement, 'contains'> | null, target: Node | null): boolean {
  return !menu?.contains(target)
}
