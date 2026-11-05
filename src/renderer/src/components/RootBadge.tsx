import type { RootState } from '@shared/models'
import type { RootMethod } from '@shared/root'
import { METHOD_LABEL } from '../root/rootActions'
import { ROOT_LABEL } from '../labels'
import { t } from '../i18n'

const TONE: Record<RootState, string> = {
  adbd: 'ok',
  'su-available': 'warn',
  none: 'muted',
  unknown: 'muted'
}

/**
 * session：右键「进入 root」建立的后台 root 会话，文件传输等也能用；
 * shellRoot：只是某个终端里 su 了，其它功能仍是普通身份，提示里说清楚
 */
export function RootBadge({
  state,
  shellRoot = false,
  session,
  compact = false
}: {
  state: RootState
  shellRoot?: boolean
  session?: RootMethod
  compact?: boolean
}) {
  if (session && state !== 'adbd') {
    return (
      <span className="badge badge-ok" title={t('已进入 root（{method}），文件传输、目录浏览也会以 root 执行', { method: METHOD_LABEL()[session] })}>
        {compact ? 'root' : t('root（{method}）', { method: METHOD_LABEL()[session] })}
      </span>
    )
  }
  if (shellRoot && state !== 'adbd') {
    return (
      <span className="badge badge-warn" title={t('只有终端里 su 成了 root，文件传输等仍是普通身份；需要时在设备列表右键「进入 root」')}>
        {compact ? 'root' : t('su root（终端）')}
      </span>
    )
  }
  if (compact && (state === 'none' || state === 'unknown')) return null
  return (
    <span className={`badge badge-${TONE[state]}`} title={ROOT_LABEL()[state]}>
      {compact ? (state === 'adbd' ? 'root' : 'su') : ROOT_LABEL()[state]}
    </span>
  )
}
