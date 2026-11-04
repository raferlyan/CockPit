import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppAction, AppPackage } from '@shared/apps'
import { api } from '../api'
import { useAppStore } from '../store'
import { deviceTitle } from '../labels'
import { ActionButton } from '../notify/ActionButton'
import { errorMessage, notify } from '../notify/notifyStore'
import { droppedPaths, hasDraggedFiles, installApks } from '../files/fileStore'
import { useUiStore } from '../settings/uiStore'
import { formatDateTime, t } from '../i18n'

type Filter = 'user' | 'system' | 'disabled' | 'uninstalled' | 'all'
type Sort = 'name' | 'installed' | 'updated'

const FILTERS: Array<{ key: Filter; label: () => string; match: (a: AppPackage) => boolean }> = [
  { key: 'user', label: () => t('用户应用'), match: (a) => a.kind === 'user' && !a.uninstalled },
  { key: 'system', label: () => t('系统应用'), match: (a) => a.kind === 'system' && !a.uninstalled },
  { key: 'disabled', label: () => t('已停用'), match: (a) => a.disabled && !a.uninstalled },
  { key: 'uninstalled', label: () => t('已卸载（可恢复）'), match: (a) => a.uninstalled },
  { key: 'all', label: () => t('全部'), match: () => true }
]

const SORTS: Array<{ key: Sort; label: () => string }> = [
  { key: 'name', label: () => t('按包名') },
  { key: 'installed', label: () => t('按安装时间') },
  { key: 'updated', label: () => t('按更新时间') }
]

const ACTION_LABEL = (): Record<AppAction, string> => ({
  launch: t('打开'),
  uninstall: t('卸载'),
  restore: t('恢复'),
  disable: t('停用'),
  enable: t('启用'),
  forceStop: t('强制停止'),
  clearData: t('清除数据')
})

/** 会丢数据或影响系统的操作先确认 */
function confirmText(action: AppAction, apps: AppPackage[]): string | null {
  const names = apps.length === 1 ? apps[0].name : t('{n} 个应用', { n: apps.length })
  const system = apps.some((a) => a.kind === 'system')
  switch (action) {
    case 'uninstall':
      return system
        ? t(
            '卸载 {names}？\n\n系统应用只会对当前用户卸载，APK 仍保留在系统分区，可在「已卸载」里恢复。卸载关键系统组件可能导致设备异常，请确认你清楚它的用途。',
            { names }
          )
        : t('卸载 {names}？应用数据会一并删除。', { names })
    case 'clearData':
      return t('清除 {names} 的全部数据？此操作不可撤销。', { names })
    case 'disable':
      return system ? t('停用 {names}？停用关键系统组件可能导致设备异常。', { names }) : null
    default:
      return null
  }
}

/** 系统预装应用的首次安装时间常是出厂时间甚至 2008/2009 年，这里照实显示 */
function TimeCell({ app }: { app: AppPackage }) {
  if (!app.firstInstallTime && !app.lastUpdateTime) return <span className="muted">—</span>
  const updated = app.lastUpdateTime && app.lastUpdateTime !== app.firstInstallTime ? app.lastUpdateTime : undefined
  return (
    <span
      className="apps-time mono"
      title={[
        app.firstInstallTime && t('首次安装 {time}', { time: formatDateTime(app.firstInstallTime) }),
        app.lastUpdateTime && t('最近更新 {time}', { time: formatDateTime(app.lastUpdateTime) })
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {app.firstInstallTime ? formatDateTime(app.firstInstallTime) : '—'}
      {updated && <span className="apps-time-sub">{t('更新 {time}', { time: formatDateTime(updated) })}</span>}
    </span>
  )
}

/** 应用管理：全量扫描设备上的应用（pm list packages），支持搜索、批量卸载、停用、恢复和导出 APK */
export function AppManagerDialog({ serial }: { serial: string }) {
  const device = useAppStore((s) => s.devices.find((d) => d.serial === serial))
  const online = device?.state === 'device'
  const close = () => useUiStore.getState().openApps(null)

  const [apps, setApps] = useState<AppPackage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('user')
  const [sort, setSort] = useState<Sort>('name')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)

  const scan = useCallback(async () => {
    setLoadError(null)
    try {
      setApps(await api.apps.list(serial))
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [serial])

  useEffect(() => {
    if (online) void scan()
  }, [online, scan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, apps?.filter(f.match).length ?? 0])) as Record<Filter, number>, [apps])

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)!.match
    const q = query.trim().toLowerCase()
    const list = (apps ?? []).filter((a) => match(a) && (!q || a.name.toLowerCase().includes(q)))
    // 新的在前；取不到时间的排最后
    if (sort === 'installed') list.sort((a, b) => (b.firstInstallTime ?? 0) - (a.firstInstallTime ?? 0))
    if (sort === 'updated') list.sort((a, b) => (b.lastUpdateTime ?? 0) - (a.lastUpdateTime ?? 0))
    return list
  }, [apps, filter, query, sort])

  const selectedApps = visible.filter((a) => selected.has(a.name))

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const run = async (action: AppAction, targets: AppPackage[]) => {
    if (!targets.length) return
    const question = confirmText(action, targets)
    if (question && !window.confirm(question)) return
    const failures: string[] = []
    const label = ACTION_LABEL()[action]
    for (const [i, app] of targets.entries()) {
      setBusy(t('正在{action} {progress}{name}…', { action: label, progress: targets.length > 1 ? `(${i + 1}/${targets.length}) ` : '', name: app.name }))
      try {
        await api.apps.run(serial, app.name, action, app.kind)
      } catch (error) {
        failures.push(`${app.name}：${errorMessage(error)}`)
      }
    }
    setBusy(null)
    if (failures.length) notify('error', t('{n} 个应用{action}失败', { n: failures.length, action: label }), failures.slice(0, 3).join('\n'))
    else if (action === 'launch') notify('success', t('已在设备上打开 {name}', { name: targets[0].name }))
    else notify('success', t('已{action} {names}', { action: label, names: targets.length > 1 ? t('{n} 个应用', { n: targets.length }) : targets[0].name }))
    if (action === 'launch') return
    setSelected(new Set())
    // 强制停止不改变列表，其余操作重新扫描
    if (action !== 'forceStop') void scan()
  }

  const exportApk = async (app: AppPackage) => {
    if (!app.apkPath) return
    const dir = await api.files.pickDirectory()
    if (!dir) return
    setBusy(t('正在导出 {name}…', { name: app.name }))
    try {
      const file = await api.apps.exportApk(serial, app.name, app.apkPath, dir)
      notify('success', t('已导出到 {file}', { file }))
      api.files.reveal(file)
    } catch (error) {
      notify('error', t('导出失败'), errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const install = async (paths: string[]) => {
    if (!paths.length) return
    setBusy(t('正在安装 {n} 个应用…', { n: paths.length }))
    await installApks(serial, paths)
    setBusy(null)
    void scan()
  }

  const offline = !online && t('设备不在线')
  const busyReason = offline || busy
  const allChecked = visible.length > 0 && visible.every((a) => selected.has(a.name))

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div
        className={`dialog apps-dialog${dropping ? ' dropping' : ''}`}
        role="dialog"
        aria-label={t('应用管理')}
        onDragOver={(e) => {
          if (!hasDraggedFiles(e)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropping(false)
          const apks = droppedPaths(e).filter((p) => /\.apk$/i.test(p))
          if (apks.length) void install(apks)
          else notify('info', t('只能拖入 .apk 文件进行安装'))
        }}
      >
        <div className="panel-title-row">
          <h2 className="panel-title">
            {t('应用管理')} · {device ? deviceTitle(device) : serial}
          </h2>
          <button className="tool" title={t('关闭')} onClick={close} disabled={Boolean(busy)}>
            ×
          </button>
        </div>

        <div className="apps-toolbar">
          <input className="apps-search mono" placeholder={t('搜索包名')} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} autoFocus />
          <select className="apps-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} title={t('排序')}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label()}
              </option>
            ))}
          </select>
          <ActionButton className="secondary" disabledReason={busyReason} onClick={() => void scan()}>
            {t('重新扫描')}
          </ActionButton>
          <ActionButton className="primary" disabledReason={busyReason} onClick={() => void api.files.pickApk().then(install)}>
            {t('安装 APK…')}
          </ActionButton>
        </div>

        <div className="segmented apps-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={f.key === filter ? 'on' : ''} onClick={() => setFilter(f.key)}>
              {f.label()} <span className="muted">{apps ? counts[f.key] : ''}</span>
            </button>
          ))}
        </div>

        <div className="apps-list">
          {loadError && (
            <p className="error">
              {t('扫描失败：')}
              {loadError}
            </p>
          )}
          {!loadError && apps === null && <p className="muted">{online ? t('正在扫描设备上的应用…') : t('设备不在线')}</p>}
          {apps && visible.length === 0 && <p className="muted">{t('没有匹配的应用')}</p>}
          {visible.length > 0 && (
            <table className="proc-table apps-table">
              <thead>
                <tr>
                  <th className="check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((a) => a.name)))}
                      title={t('全选当前列表')}
                    />
                  </th>
                  <th>{t('包名')}</th>
                  <th className="apps-time-col">{t('安装时间')}</th>
                  <th>{t('状态')}</th>
                  <th className="num">{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((app) => (
                  <tr key={app.name} className={selected.has(app.name) ? 'selected' : ''}>
                    <td className="check">
                      <input type="checkbox" checked={selected.has(app.name)} onChange={() => toggle(app.name)} />
                    </td>
                    <td className="proc-name mono" title={app.apkPath}>
                      {app.name}
                    </td>
                    <td className="apps-time-col">
                      <TimeCell app={app} />
                    </td>
                    <td className="apps-tags">
                      <span className={`tag${app.kind === 'system' ? ' system' : ''}`}>{app.kind === 'system' ? t('系统') : t('用户')}</span>
                      {app.disabled && <span className="tag warn">{t('已停用')}</span>}
                      {app.uninstalled && <span className="tag err">{t('已卸载')}</span>}
                    </td>
                    <td className="num apps-actions">
                      {app.uninstalled ? (
                        <ActionButton className="tool" disabledReason={busyReason} onClick={() => void run('restore', [app])}>
                          {t('恢复')}
                        </ActionButton>
                      ) : (
                        <>
                          <ActionButton
                            className="tool accent"
                            disabledReason={busyReason || (app.disabled && t('应用已停用，先启用再打开'))}
                            title={t('在设备上打开到前台')}
                            onClick={() => void run('launch', [app])}
                          >
                            {t('打开')}
                          </ActionButton>
                          <ActionButton className="tool" disabledReason={busyReason} onClick={() => void run('forceStop', [app])}>
                            {t('停止')}
                          </ActionButton>
                          <ActionButton className="tool" disabledReason={busyReason} onClick={() => void run('clearData', [app])}>
                            {t('清数据')}
                          </ActionButton>
                          <ActionButton className="tool" disabledReason={busyReason} onClick={() => void run(app.disabled ? 'enable' : 'disable', [app])}>
                            {app.disabled ? t('启用') : t('停用')}
                          </ActionButton>
                          <ActionButton className="tool" disabledReason={busyReason || (!app.apkPath && t('取不到 APK 路径'))} onClick={() => void exportApk(app)}>
                            {t('导出')}
                          </ActionButton>
                          <ActionButton className="tool danger" disabledReason={busyReason} onClick={() => void run('uninstall', [app])}>
                            {t('卸载')}
                          </ActionButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dialog-actions">
          <span className="muted">{busy ?? (selectedApps.length ? t('已选 {n} 个', { n: selectedApps.length }) : t('可把 APK 拖到此处安装'))}</span>
          <span className="spacer" />
          {selectedApps.length > 0 && (
            <>
              {selectedApps.some((a) => a.uninstalled) && (
                <ActionButton className="secondary" disabledReason={busyReason} onClick={() => void run('restore', selectedApps.filter((a) => a.uninstalled))}>
                  {t('恢复所选')}
                </ActionButton>
              )}
              <ActionButton className="secondary" disabledReason={busyReason} onClick={() => void run('disable', selectedApps.filter((a) => !a.uninstalled && !a.disabled))}>
                {t('停用所选')}
              </ActionButton>
              <ActionButton className="primary danger" disabledReason={busyReason} onClick={() => void run('uninstall', selectedApps.filter((a) => !a.uninstalled))}>
                {t('卸载所选')}
              </ActionButton>
            </>
          )}
        </div>
        {dropping && <div className="apps-drop-hint">{t('松开鼠标安装 APK')}</div>}
      </div>
    </div>
  )
}
