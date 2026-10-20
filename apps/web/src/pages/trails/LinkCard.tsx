import { useTranslation } from 'react-i18next'
import { Avatar, Box, Typography } from '@mui/material'
import PersonIcon from '@mui/icons-material/Person'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import BusinessIcon from '@mui/icons-material/Business'
import SellIcon from '@mui/icons-material/Sell'
import { getProxiedImageUrl } from '@aperture/ui'
import type { TrailEntity, TrailEntityKind } from './types'
import { KIND_COLOR, rarityText } from './labels'

const KIND_ICON: Record<TrailEntityKind, typeof PersonIcon> = {
  person: PersonIcon,
  franchise: CollectionsBookmarkIcon,
  company: BusinessIcon,
  keyword: SellIcon,
}

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

interface LinkCardProps {
  entity: TrailEntity
  /** What the link is between the titles it joins ("Cinematographer on both"). */
  caption: string
  /** Smaller, for the links offered beside a step. */
  dense?: boolean
}

/**
 * A named link: who or what it is, what it was in the titles it joins, and how
 * many titles in the library share it — the count is the rarity, stated so the
 * reader can check it.
 */
export function LinkCard({ entity, caption, dense = false }: LinkCardProps) {
  const { t } = useTranslation()
  const rarity = rarityText(entity.titleCount)
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: dense ? 1 : 1.25,
        py: dense ? 0.5 : 0.75,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        borderInlineStart: 3,
        borderInlineStartColor: KIND_COLOR[entity.kind],
        bgcolor: 'background.paper',
        minWidth: 0,
      }}
    >
      <EntityAvatar entity={entity} size={dense ? 24 : 32} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant={dense ? 'caption' : 'body2'} fontWeight={600} noWrap component="div" title={entity.name}>
          {entity.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {caption}
        </Typography>
        {!dense && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ opacity: 0.8 }}>
            {rarity.key === 'trails.rarity.onlyTwo' ? t(rarity.key) : t(rarity.key, { count: rarity.count })}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
