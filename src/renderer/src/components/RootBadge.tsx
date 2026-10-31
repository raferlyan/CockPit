import type { RootState } from '@shared/models'
import { ROOT_LABEL } from '../labels'

const TONE: Record<RootState, string> = {
  adbd: 'ok',
  'su-available': 'warn',
  none: 'muted',
  unknown: 'muted'
}

export function RootBadge({ state, compact = false }: { state: RootState; compact?: boolean }) {
  if (compact && (state === 'none' || state === 'unknown')) return null
  return (
    <span className={`badge badge-${TONE[state]}`} title={ROOT_LABEL[state]}>
      {compact ? (state === 'adbd' ? 'root' : 'su') : ROOT_LABEL[state]}
    </span>
  )
}
