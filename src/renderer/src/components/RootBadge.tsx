import type { RootState } from '@shared/models'
import { ROOT_LABEL } from '../labels'
import { t } from '../i18n'

const TONE: Record<RootState, string> = {
  adbd: 'ok',
  'su-available': 'warn',
  none: 'muted',
  unknown: 'muted'
}

/** shellRoot：应用内有终端已经 su 成功，此时同样显示为 root */
export function RootBadge({ state, shellRoot = false, compact = false }: { state: RootState; shellRoot?: boolean; compact?: boolean }) {
  if (shellRoot && state !== 'adbd') {
    return (
      <span className="badge badge-ok" title={t('终端已通过 su 切换到 root')}>
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
