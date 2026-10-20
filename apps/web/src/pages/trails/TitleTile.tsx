import { useTranslation } from 'react-i18next'
import { Box, IconButton, Tooltip } from '@mui/material'
import AltRouteIcon from '@mui/icons-material/AltRoute'
import { MoviePoster } from '@aperture/ui'
import { useWatchStatus } from '@/hooks/useWatchStatus'
import type { TrailTitle } from './types'

interface TitleTileProps {
  title: TrailTitle
  onOpen: (title: TrailTitle) => void
  /** Follow the threads out of this title; absent draws no button. */
  onFollow?: (title: TrailTitle) => void
  width?: number
  /** Drawn with a ring: the title a trail starts or ends at. */
  emphasised?: boolean
}

/**
 * One title on a trail: a poster carrying the viewer's watched tick or episode
 * count, opening the title's details on click. Following its threads is the
 * corner button, so a click always means "show me this".
 */
export function TitleTile({ title, onOpen, onFollow, width = 112, emphasised = false }: TitleTileProps) {
  const { t } = useTranslation()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  return (
    <Box
      sx={{
        width,
        flexShrink: 0,
        borderRadius: 2,
        outline: emphasised ? 2 : 0,
        outlineColor: 'primary.main',
        outlineOffset: 3,
      }}
    >
      <MoviePoster
        title={title.title}
        year={title.year}
        posterUrl={title.posterUrl}
        titleRef={{ mediaType: title.type, id: title.id }}
        watched={isWatched(title.type, title.id)}
        episodeProgress={getEpisodeProgress(title.type, title.id)}
        onClick={() => onOpen(title)}
        size="small"
        responsive
        titleLines={2}
        hideRating
        hideUserRating
        hideWatchingToggle
        hideExploreButton
      >
        {onFollow && (
          <Tooltip title={t('trails.actions.follow', { title: title.title })}>
            <IconButton
              size="small"
              aria-label={t('trails.actions.follow', { title: title.title })}
              onClick={(event) => {
                event.stopPropagation()
                onFollow(title)
              }}
              sx={{
                position: 'absolute',
                top: 6,
                insetInlineStart: 6,
                bgcolor: 'rgba(0,0,0,0.6)',
                color: 'common.white',
                '&:hover': { bgcolor: 'primary.main' },
              }}
            >
              <AltRouteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </MoviePoster>
    </Box>
  )
}
