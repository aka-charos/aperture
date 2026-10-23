import { Avatar } from '@mui/material'
import PersonIcon from '@mui/icons-material/Person'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import BusinessIcon from '@mui/icons-material/Business'
import SellIcon from '@mui/icons-material/Sell'
import { getProxiedImageUrl } from '@aperture/ui'
import type { TrailEntity, TrailEntityKind } from './types'
import { KIND_COLOR } from './trail'

const KIND_ICON: Record<TrailEntityKind, typeof PersonIcon> = {
  person: PersonIcon,
  franchise: CollectionsBookmarkIcon,
  company: BusinessIcon,
  keyword: SellIcon,
}

/** A row's or a step's person (their photo), franchise, company or theme (an icon), in its kind's colour. */
export function EntityAvatar({ entity, size = 32 }: { entity: TrailEntity; size?: number }) {
  const Icon = KIND_ICON[entity.kind]
  return (
    <Avatar
      src={entity.kind === 'person' && entity.photo ? getProxiedImageUrl(entity.photo) : undefined}
      alt=""
      sx={{ width: size, height: size, bgcolor: KIND_COLOR[entity.kind], flexShrink: 0 }}
    >
      <Icon sx={{ fontSize: size * 0.55 }} />
    </Avatar>
  )
}
