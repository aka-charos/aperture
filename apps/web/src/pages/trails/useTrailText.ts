import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { hereCaption, roleKey, stepCaption, type HereCaption, type StepCaption } from './labels'
import type { TrailEntityKind, TrailLink, TrailRole } from './types'

/** The page's wording of links, from the pure decisions in labels.ts. */
export function useTrailText() {
  const { t } = useTranslation()

  const role = useCallback((value: TrailRole) => t(roleKey(value)), [t])

  const caption = useCallback(
    (decided: StepCaption | HereCaption): string => {
      switch (decided.key) {
        case 'trails.caption.same':
          return t(decided.key, { role: role(decided.role) })
        case 'trails.caption.differs':
          return t(decided.key, { from: role(decided.from), to: role(decided.to) })
        case 'trails.here.role':
          return t(decided.key, { role: role(decided.role) })
        default:
          return t(decided.key)
      }
    },
    [t, role]
  )

  const stepText = useCallback(
    (link: Pick<TrailLink, 'kind' | 'rolesFrom' | 'rolesTo'>) => caption(stepCaption(link)),
    [caption]
  )

  const hereText = useCallback(
    (kind: TrailEntityKind, roles: readonly TrailRole[]) => caption(hereCaption(kind, roles)),
    [caption]
  )

  return { role, stepText, hereText }
}
