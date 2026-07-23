/**
 * Single content item card for Tool UI
 * Full-width list layout: poster + title/meta + synopsis + "why it fits" note.
 */
import { Box, Typography, Button, Chip, Paper, IconButton, CircularProgress } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import InfoIcon from '@mui/icons-material/Info'
import StarIcon from '@mui/icons-material/Star'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RankBadge, getProxiedImageUrl } from '@aperture/ui'
import type { ContentItem } from './types'

interface ContentCardProps {
  item: ContentItem
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

export function ContentCard({ item, onPlay, isFavorite, favoritePending, onToggleFavorite }: ContentCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
        gap: 1.75,
        p: 1.75,
        width: '100%',
        bgcolor: '#1a1a1a',
        borderRadius: 2,
        cursor: 'pointer',
        transition: 'background-color 0.2s, border-color 0.2s',
        border: '1px solid transparent',
        '&:hover': {
          bgcolor: '#212121',
          borderColor: 'rgba(99, 102, 241, 0.35)',
        },
      }}
      onClick={handleDetails}
    >
      {/* Poster */}
      <Box
        sx={{
          width: 80,
          height: 120,
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
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" fontWeight={600} sx={{ color: '#fff', ...clampLines(2) }}>
          {item.name}
        </Typography>

        {item.subtitle && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {item.subtitle}
          </Typography>
        )}

        {/* Ratings row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
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
            <Chip
              icon={<FavoriteIcon sx={{ fontSize: 12 }} />}
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

        {/* Synopsis */}
        {item.overview && (
          <Typography
            variant="caption"
            sx={{ color: '#a1a1aa', lineHeight: 1.45, ...clampLines(3) }}
          >
            {item.overview}
          </Typography>
        )}

        {/* Why it fits */}
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
            <LightbulbOutlinedIcon sx={{ fontSize: 15, color: '#818cf8', flexShrink: 0, mt: '1px' }} />
            <Typography variant="caption" sx={{ color: '#c7c7d1', lineHeight: 1.45 }}>
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
