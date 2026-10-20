import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Tooltip, Typography } from '@mui/material'
import EastIcon from '@mui/icons-material/East'
import WestIcon from '@mui/icons-material/West'
import { useTheme } from '@mui/material/styles'
import { TitleTile } from './TitleTile'
import { EntityAvatar } from './LinkCard'
import { KIND_COLOR, pairKey } from './labels'
import { useTrailText } from './useTrailText'
import type { TrailLink, TrailTitle } from './types'

interface TrailStripProps {
  /** The trail's refs, oldest first. */
  trail: readonly string[]
  cards: ReadonlyMap<string, TrailTitle>
  links: ReadonlyMap<string, TrailLink | null>
  /** Go back to the title at this position, cutting the trail there. */
  onStepBack: (position: number) => void
  onOpen: (title: TrailTitle) => void
}

/**
 * The trail so far as it reads: posters joined by what links each to the
 * next. The last poster is where the threads below lead out of; any earlier
 * one can be gone back to (its corner button). A title the viewer cannot see
 * any more (out of scope, deleted) is left out, and the link drawn is then
 * between the titles either side of it.
 */
export function TrailStrip({ trail, cards, links, onStepBack, onOpen }: TrailStripProps) {
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null)
  const shown = trail
    .map((ref, position) => ({ position, card: cards.get(ref) }))
    .filter((entry): entry is { position: number; card: TrailTitle } => entry.card != null)

  // Keep the newest step in view as the trail grows.
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const end = getComputedStyle(element).direction === 'rtl' ? -element.scrollWidth : element.scrollWidth
    element.scrollTo({ left: end, behavior: 'smooth' })
  }, [trail.length])

  if (shown.length < 2) return null
  const last = shown[shown.length - 1].position

  return (
    <Box
      ref={scroller}
      role="list"
      aria-label={t('trails.threads.trail')}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, overflowX: 'auto', pb: 1.5 }}
    >
      {shown.map(({ position, card }, index) => (
        <Box key={card.ref} role="listitem" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexShrink: 0 }}>
          {index > 0 && <Connector link={links.get(pairKey(shown[index - 1].card.ref, card.ref)) ?? null} />}
          <TitleTile
            title={card}
            onOpen={onOpen}
            width={92}
            emphasised={position === last}
            onFollow={position === last ? undefined : () => onStepBack(position)}
            followLabel={t('trails.strip.back', { title: card.title })}
          />
        </Box>
      ))}
    </Box>
  )
}

/** What joins two titles on the trail: the thing followed, or an arrow when it is not known. */
function Connector({ link }: { link: TrailLink | null }) {
  const { stepText } = useTrailText()
  const Arrow = useTheme().direction === 'rtl' ? WestIcon : EastIcon
  return (
    <Box
      sx={{
        width: 96,
        flexShrink: 0,
        alignSelf: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        mt: -4,
        textAlign: 'center',
      }}
    >
      {link ? (
        <Tooltip title={stepText(link)}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, minWidth: 0, width: '100%' }}>
            <EntityAvatar entity={link} size={28} />
            <Typography
              variant="caption"
              fontWeight={600}
              sx={{
                lineHeight: 1.2,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {link.name}
            </Typography>
            <Box sx={{ width: '100%', height: 2, borderRadius: 1, bgcolor: KIND_COLOR[link.kind] }} />
          </Box>
        </Tooltip>
      ) : (
        <Arrow color="disabled" />
      )}
    </Box>
  )
}
