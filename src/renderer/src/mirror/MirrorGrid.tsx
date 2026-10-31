import { MAX_MIRROR_TILES, useAppStore } from '../store'
import { deviceTitle, STATE_LABEL } from '../labels'
import { ErrorBoundary } from '../notify/ErrorBoundary'
import { MirrorView } from './MirrorView'

/** 1–3 台排成一行（手机竖屏并排最省空间），4 台排成 2×2 */
function columnsFor(count: number): number {
  return count <= 3 ? Math.max(count, 1) : 2
}

/**
 * 投屏区：每台设备一个窗格，切换焦点设备时其它窗格的投屏不中断。
 * 网格模式同时显示所有窗格；单台模式只显示焦点设备，其余窗格在后台继续会话。
 */
export function MirrorGrid() {
  const devices = useAppStore((s) => s.devices)
  const tiles = useAppStore((s) => s.mirrorTiles)
  const layout = useAppStore((s) => s.mirrorLayout)
  const focusedSerial = useAppStore((s) => s.focusedSerial)
  const { focus, addTile, removeTile, setMirrorLayout } = useAppStore.getState()

  const candidates = devices.filter((d) => d.state === 'device' && !tiles.includes(d.serial))
  const single = layout === 'single'
  const visibleCount = single ? (tiles.includes(focusedSerial ?? '') ? 1 : 0) : tiles.length
  const multi = tiles.length > 1

  return (
    <section className="mirror-area">
      {(tiles.length > 1 || candidates.length > 0) && (
        <div className="mirror-bar">
          <div className="segmented">
            <button className={single ? '' : 'on'} onClick={() => setMirrorLayout('grid')}>
              网格
            </button>
            <button className={single ? 'on' : ''} onClick={() => setMirrorLayout('single')}>
              单台
            </button>
          </div>
          <span className="muted">
            {tiles.length} / {MAX_MIRROR_TILES} 台
          </span>
          <span className="spacer" />
          {candidates.length > 0 && (
            <select
              className="mirror-add"
              value=""
              onChange={(e) => e.target.value && addTile(e.target.value)}
              title="把另一台在线设备加入投屏区"
            >
              <option value="">+ 添加设备</option>
              {candidates.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {deviceTitle(d)}（{d.serial}）
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mirror-grid" style={{ ['--cols' as string]: columnsFor(visibleCount) }}>
        {tiles.map((serial) => {
          const device = devices.find((d) => d.serial === serial)
          if (!device) return null
          const hidden = single && serial !== focusedSerial
          if (device.state !== 'device') {
            return hidden ? null : (
              <div key={serial} className="mirror-offline placeholder">
                <span>
                  {deviceTitle(device)}：{STATE_LABEL[device.state]}
                </span>
                <button className="secondary" onClick={() => removeTile(serial)}>
                  关闭窗格
                </button>
              </div>
            )
          }
          return (
            <ErrorBoundary key={serial} name={`${deviceTitle(device)} 投屏`}>
              <MirrorView
                device={device}
                active={serial === focusedSerial}
                hidden={hidden}
                multi={multi}
                onActivate={() => serial !== useAppStore.getState().focusedSerial && focus(serial)}
                onClose={() => removeTile(serial)}
              />
            </ErrorBoundary>
          )
        })}
        {visibleCount === 0 && (
          <div className="placeholder mirror-empty">
            {candidates.length > 0 ? '从右上角「+ 添加设备」把设备加入投屏区' : '选择一台在线设备开始投屏'}
          </div>
        )}
      </div>
    </section>
  )
}
