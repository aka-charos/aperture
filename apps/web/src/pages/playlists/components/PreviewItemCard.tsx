/**
 * One proposed title in the preview list.
 *
 * Deliberately built to the same geometry as the assistant's chat cards
 * (`components/assistant/tool-ui/ContentCard.tsx`): a fixed-width meta rail carrying the poster
 * with rating and genres stacked under it, then a text column with the title, the synopsis, and
 * the model's "why it fits" note in a bordered block. Rebuilt rather than imported because the
 * chat card's affordances are wrong here — its body click opens media detail (which would
 * navigate out from under this dialog) and its action row is play/favorite, where a preview needs
 * a rank, a seed badge and a remove button.
 */
import { Box, Typography, Chip, Paper, IconButton, Tooltip } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { getProxiedImageUrl } from '@aperture/ui'
import type { PreviewItem } from '../types'

/** Meta rail width; the poster fills it at a 2:3 poster ratio. Matches the chat card. */
const RAIL_WIDTH = 84
const POSTER_HEIGHT = 126
/** The dialog is a fixed md width, so a fixed synopsis clamp is safe here. */
const OVERVIEW_LINES = 4

const clampLines = (lines: number) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
})

interface PreviewItemCardProps {
  item: PreviewItem
  /** 1-based position in the list — this is the order that gets written. */
  rank: number
  onRemove: (itemId: string) => void
  removeDisabled?: boolean
  /** Namespace so the same card serves the playlists and collections pages. */
  pt: (key: string, options?: Record<string, unknown>) => string
}

export function PreviewItemCard({
  item,
  rank,
  onRemove,
  removeDisabled,
  pt,
}: PreviewItemCardProps) {
  return (
    <Paper
      sx={{
        display: 'flex',
        gap: 1.75,
        p: 1.75,
        bgcolor: '#1a1a1a',
        borderRadius: 2,
        border: '1px solid transparent',
        transition: 'background-color 0.2s, border-color 0.2s',
        '&:hover': { bgcolor: '#212121', borderColor: 'rgba(99, 102, 241, 0.35)' },
      }}
    >
      {/* Meta rail: poster + specs */}
      <Box
        sx={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
      >
        <Box
          sx={{
            width: '100%',
            height: POSTER_HEIGHT,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: '#2a2a2a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
          }}
        >
          {item.posterUrl ? (
            <Box
              component="img"
              src={getProxiedImageUrl(item.posterUrl)}
              alt={item.title}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : item.mediaType === 'series' ? (
            <TvIcon />
          ) : (
            <MovieIcon />
          )}
        </Box>

        {item.rating != null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <StarIcon sx={{ fontSize: 12, color: '#ffc107' }} />
            <Typography
              variant="caption"
              sx={{ color: '#ffc107', fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}
            >
              {item.rating.toFixed(1)}
            </Typography>
          </Box>
        )}

        {item.genres.length > 0 && (
          <Typography
            variant="caption"
            sx={{ color: '#71717a', fontSize: 10, lineHeight: 1.35, ...clampLines(2) }}
          >
            {item.genres.join(', ')}
          </Typography>
        )}
      </Box>

      {/* Text column */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
          {/* The rank is the write order, so it belongs with the identity line, not off in a
              column of its own that only lines up while every card is the same height. */}
          <Typography
            variant="body2"
            sx={{ color: '#71717a', fontWeight: 600, flexShrink: 0, mt: '1px' }}
          >
            {rank}
          </Typography>
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{ color: '#fff', flex: 1, minWidth: 0, ...clampLines(2) }}
          >
            {item.title}
            {item.year && (
              <Box component="span" sx={{ color: '#a1a1aa', fontWeight: 400 }}>
                {' '}
                ({item.year})
              </Box>
            )}
          </Typography>
          {item.isSeed && (
            <Chip
              label={pt('previewSeedBadge')}
              size="small"
              sx={{
                flexShrink: 0,
                mt: '1px',
                height: 18,
                bgcolor: 'rgba(236, 72, 153, 0.15)',
                color: '#ec4899',
                '& .MuiChip-label': { px: 0.625, fontSize: 10 },
              }}
            />
          )}
          <Chip
            label={item.mediaType === 'movie' ? pt('mediaTypeMovies') : pt('mediaTypeSeries')}
            size="small"
            sx={{
              flexShrink: 0,
              mt: '1px',
              height: 18,
              bgcolor:
                item.mediaType === 'movie' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: item.mediaType === 'movie' ? '#818cf8' : '#10b981',
              '& .MuiChip-label': { px: 0.625, fontSize: 10 },
            }}
          />
          <Tooltip title={pt('previewRemoveItem')}>
            <span>
              <IconButton
                size="small"
                color="error"
                onClick={() => onRemove(item.id)}
                disabled={removeDisabled}
                sx={{ p: 0.25, mt: '-2px' }}
              >
                <RemoveCircleOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {item.runtime ? (
          <Typography variant="caption" sx={{ color: '#71717a' }}>
            {pt('previewRuntimeMinutes', { minutes: item.runtime })}
          </Typography>
        ) : null}

        {item.overview && (
          <Typography
            variant="caption"
            sx={{ color: '#a1a1aa', lineHeight: 1.45, ...clampLines(OVERVIEW_LINES) }}
          >
            {item.overview}
          </Typography>
        )}

        {/* Why the recommender chose this. Never clamped: it is one model-written sentence and
            the only text on the card that exists nowhere else in the app. */}
        {item.reason && (
          <Box
            sx={{
              display: 'flex',
              gap: 0.75,
              mt: 0.25,
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(99, 102, 241, 0.08)',
              borderInlineStart: '2px solid #6366f1',
            }}
          >
            <LightbulbOutlinedIcon
              sx={{ fontSize: 15, color: '#818cf8', flexShrink: 0, mt: '1px' }}
            />
            <Typography variant="caption" sx={{ color: '#c7c7d1', lineHeight: 1.45 }}>
              {item.reason}
            </Typography>
          </Box>
        )}

        {/* Seeds get the one explanation a model shouldn't be asked to write. */}
        {item.isSeed && !item.reason && (
          <Typography variant="caption" sx={{ color: '#71717a', fontStyle: 'italic' }}>
            {pt('previewSeedReason')}
          </Typography>
        )}
      </Box>
    </Paper>
  )
}
