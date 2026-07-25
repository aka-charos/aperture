/**
 * Single content item card for Tool UI.
 *
 * Two variants:
 * - 'compact' (default): the original fixed-width card used in horizontal
 *   carousels (semantic "Also worth checking", library search/top-rated, etc.).
 * - 'list': a full-width card used in the vertical web-search recommendations
 *   list — adds the synopsis and the per-title "why it fits" reason.
 */
import { Box, Typography, Button, Chip, Paper, IconButton, CircularProgress } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import InfoIcon from '@mui/icons-material/Info'
import StarIcon from '@mui/icons-material/Star'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RankBadge, getProxiedImageUrl } from '@aperture/ui'
import type { ContentItem } from './types'

interface ContentCardProps {
  item: ContentItem
  /** 'compact' = fixed-width carousel card; 'list' = full-width card with synopsis + reason. */
  variant?: 'compact' | 'list'
  onPlay?: (id: string, href: string) => void
  isFavorite?: boolean
  favoritePending?: boolean
  onToggleFavorite?: (item: ContentItem) => void
}

// Truncate multi-line text with an ellipsis after `lines` rows.
const clampLines = (lines: number) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
})

export function ContentCard({
  item,
  variant = 'compact',
  onPlay,
  isFavorite,
  favoritePending,
  onToggleFavorite,
}: ContentCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isList = variant === 'list'

  const detailsAction = item.actions?.find(a => a.id === 'details')
  const playAction = item.actions?.find(a => a.id === 'play')

  const handleDetails = () => {
    if (detailsAction?.href) {
      navigate(detailsAction.href)
    }
  }

  const handlePlay = () => {
    if (playAction?.href) {
      if (onPlay) {
        onPlay(item.id, playAction.href)
      } else {
        window.open(playAction.href, '_blank')
      }
    }
  }

  return (
    <Paper
      sx={{
        display: 'flex',
        gap: isList ? 1.75 : 1.5,
        p: isList ? 1.75 : 1.5,
        bgcolor: '#1a1a1a',
        borderRadius: 2,
        cursor: 'pointer',
        ...(isList
          ? {
              width: '100%',
              border: '1px solid transparent',
              transition: 'background-color 0.2s, border-color 0.2s',
              '&:hover': {
                bgcolor: '#212121',
                borderColor: 'rgba(99, 102, 241, 0.35)',
              },
            }
          : {
              minWidth: 280,
              maxWidth: 320,
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: '#252525',
                transform: 'translateY(-2px)',
              },
            }),
      }}
      onClick={handleDetails}
    >
      {/* Poster */}
      <Box
        sx={{
          width: isList ? 80 : 60,
          height: isList ? 120 : 90,
          flexShrink: 0,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: '#2a2a2a',
          position: 'relative',
        }}
      >
        {item.image ? (
          <Box
            component="img"
            src={getProxiedImageUrl(item.image)}
            alt={item.name}
            sx={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
              fontSize: 10,
              textAlign: 'center',
              px: 0.5,
            }}
          >
            {t('assistantToolUi.noImage')}
          </Box>
        )}
        {/* Rank badge */}
        {item.rank && <RankBadge rank={item.rank} size="small" />}

        {/* Favorite toggle */}
        {onToggleFavorite && (
          <IconButton
            size="small"
            disabled={favoritePending}
            aria-label={isFavorite ? t('assistantToolUi.removeFavorite') : t('assistantToolUi.favorite')}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(item)
            }}
            sx={{
              position: 'absolute',
              top: 2,
              insetInlineEnd: 2,
              p: 0.25,
              bgcolor: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(4px)',
              '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.78)' },
            }}
          >
            {favoritePending ? (
              <CircularProgress size={14} sx={{ color: '#ec4899' }} />
            ) : isFavorite ? (
              <FavoriteIcon sx={{ fontSize: 16, color: '#ec4899' }} />
            ) : (
              <FavoriteBorderIcon sx={{ fontSize: 16, color: '#fff' }} />
            )}
          </IconButton>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: isList ? 0.5 : 0 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          noWrap={!isList}
          sx={{ color: '#fff', ...(isList ? clampLines(2) : {}) }}
        >
          {item.name}
        </Typography>

        {item.subtitle && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {item.subtitle}
          </Typography>
        )}

        {/* Director (movies) / creator (series) — the same DB column serves both */}
        {item.director && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <MovieCreationOutlinedIcon sx={{ fontSize: 12, color: '#71717a', flexShrink: 0 }} />
            <Typography variant="caption" noWrap sx={{ color: '#a1a1aa', minWidth: 0 }}>
              {item.type === 'movie'
                ? t('assistantToolUi.directedBy', { name: item.director })
                : t('assistantToolUi.createdBy', { name: item.director })}
            </Typography>
          </Box>
        )}

        {/* Ratings row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: isList ? 0 : 0.5, flexWrap: 'wrap' }}>
          {item.rating != null && (
            <Chip
              icon={<StarIcon sx={{ fontSize: 12 }} />}
              label={Number(item.rating).toFixed(1)}
              size="small"
              sx={{
                height: 20,
                bgcolor: 'rgba(255, 193, 7, 0.15)',
                color: '#ffc107',
                '& .MuiChip-icon': { color: '#ffc107' },
                '& .MuiChip-label': { px: 0.5, fontSize: 11 },
              }}
            />
          )}
          {item.userRating && (
            // Star, not a heart: the heart on the poster means "favorite", and the
            // same icon carrying two meanings on one card is what made it ambiguous.
            <Chip
              icon={<StarIcon sx={{ fontSize: 12 }} />}
              label={item.userRating}
              size="small"
              sx={{
                height: 20,
                bgcolor: 'rgba(236, 72, 153, 0.15)',
                color: '#ec4899',
                '& .MuiChip-icon': { color: '#ec4899' },
                '& .MuiChip-label': { px: 0.5, fontSize: 11 },
              }}
            />
          )}
          <Chip
            label={item.type === 'movie' ? t('assistantToolUi.movie') : t('assistantToolUi.series')}
            size="small"
            sx={{
              height: 20,
              bgcolor: item.type === 'movie' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: item.type === 'movie' ? '#818cf8' : '#10b981',
              '& .MuiChip-label': { px: 0.5, fontSize: 11 },
            }}
          />
        </Box>

        {/* Synopsis + "why it fits".
            Rendered in BOTH variants: the secondary "Also worth checking" carousel
            used to be a row of bare cards sitting next to fully explained ones.
            Compact just clamps tighter to keep the carousel card size sane. */}
        {item.overview && (
          <Typography
            variant="caption"
            sx={{
              color: '#a1a1aa',
              lineHeight: 1.45,
              mt: isList ? 0 : 0.5,
              ...clampLines(isList ? 3 : 2),
            }}
          >
            {item.overview}
          </Typography>
        )}
        {item.reason && (
          <Box
            sx={{
              display: 'flex',
              gap: 0.75,
              mt: isList ? 0.25 : 0.5,
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(99, 102, 241, 0.08)',
              borderInlineStart: '2px solid #6366f1',
            }}
          >
            <LightbulbOutlinedIcon sx={{ fontSize: 15, color: '#818cf8', flexShrink: 0, mt: '1px' }} />
            <Typography
              variant="caption"
              sx={{ color: '#c7c7d1', lineHeight: 1.45, ...(isList ? {} : clampLines(4)) }}
            >
              {item.reason}
            </Typography>
          </Box>
        )}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<InfoIcon sx={{ fontSize: 14 }} />}
            onClick={(e) => {
              e.stopPropagation()
              handleDetails()
            }}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.25,
              fontSize: 11,
              borderColor: '#3a3a3a',
              color: '#a1a1aa',
              '&:hover': {
                borderColor: '#6366f1',
                bgcolor: 'rgba(99, 102, 241, 0.1)',
              },
            }}
          >
            {t('assistantToolUi.details')}
          </Button>
          {playAction && (
            <Button
              size="small"
              variant="contained"
              startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => {
                e.stopPropagation()
                handlePlay()
              }}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 11,
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                },
              }}
            >
              {t('assistantToolUi.play')}
            </Button>
          )}
        </Box>
      </Box>
    </Paper>
  )
}
