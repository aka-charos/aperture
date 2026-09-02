/**
 * Content detail view for Tool UI
 * Rich display of a single movie or series
 */
import { Box, Typography, Paper, Chip, Button, Divider } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import InfoIcon from '@mui/icons-material/Info'
import StarIcon from '@mui/icons-material/Star'
import FavoriteIcon from '@mui/icons-material/Favorite'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProxiedImageUrl } from '@aperture/ui'
import { useMediaDetailModal } from '@/hooks/useMediaDetailModal'
import { gradients, extraColors } from '@/theme'
import { chatText } from '../density'
import type { ContentDetailData } from './types'

interface ContentDetailProps {
  data: ContentDetailData
}

export function ContentDetail({ data }: ContentDetailProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  // See ContentCard: null on surfaces where routing keeps the chat visible.
  const openMediaDetail = useMediaDetailModal()

  const detailsAction = data.actions.find(a => a.id === 'details')
  const playAction = data.actions.find(a => a.id === 'play')

  const handleDetails = () => {
    if (!detailsAction?.href) return
    if (openMediaDetail) {
      openMediaDetail(data.type, data.contentId)
      return
    }
    navigate(detailsAction.href)
  }

  const handlePlay = () => {
    if (playAction?.href) {
      window.open(playAction.href, '_blank')
    }
  }

  return (
    <Paper sx={{ p: 2, bgcolor: theme.palette.background.paper, borderRadius: 2, my: 2 }}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        {/* Poster */}
        <Box
          sx={{
            width: 120,
            height: 180,
            flexShrink: 0,
            borderRadius: 1.5,
            overflow: 'hidden',
            bgcolor: theme.palette.divider,
          }}
        >
          {data.image ? (
            <Box
              component="img"
              src={getProxiedImageUrl(data.image)}
              alt={data.name}
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
                fontSize: chatText(12),
              }}
            >
              {t('assistantToolUi.noImage')}
            </Box>
          )}
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Title and type */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
            <Typography variant="h6" fontWeight={700} sx={{ color: '#fff' }}>
              {data.name}
            </Typography>
            <Chip
              label={data.type === 'movie' ? t('assistantToolUi.movie') : t('assistantToolUi.series')}
              size="small"
              sx={{
                height: 20,
                bgcolor: data.type === 'movie' ? alpha(theme.palette.primary.main, 0.15) : 'rgba(16, 185, 129, 0.15)',
                color: data.type === 'movie' ? theme.palette.primary.light : '#10b981',
              }}
            />
          </Box>

          {/* Year / Year Range */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {data.yearRange || data.year}
            {data.runtime && ` · ${data.runtime}`}
            {data.contentRating && ` · ${data.contentRating}`}
          </Typography>

          {/* Tagline */}
          {data.tagline && (
            <Typography variant="body2" fontStyle="italic" color="text.secondary" sx={{ mb: 1 }}>
              "{data.tagline}"
            </Typography>
          )}

          {/* Ratings */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            {data.communityRating && (
              <Chip
                icon={<StarIcon sx={{ fontSize: 14 }} />}
                label={Number(data.communityRating).toFixed(1)}
                size="small"
                sx={{
                  height: 24,
                  bgcolor: 'rgba(255, 193, 7, 0.15)',
                  color: '#ffc107',
                  '& .MuiChip-icon': { color: '#ffc107' },
                }}
              />
            )}
            {data.userRating && (
              <Chip
                icon={<FavoriteIcon sx={{ fontSize: 14 }} />}
                label={`${data.userRating}/10`}
                size="small"
                sx={{
                  height: 24,
                  bgcolor: 'rgba(236, 72, 153, 0.15)',
                  color: '#ec4899',
                  '& .MuiChip-icon': { color: '#ec4899' },
                }}
              />
            )}
            {data.isWatched && (
              <Chip
                icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                label={
                  data.playCount && data.playCount > 1
                    ? t('assistantToolUi.watchedCount', { count: data.playCount })
                    : t('assistantToolUi.watched')
                }
                size="small"
                sx={{
                  height: 24,
                  bgcolor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  '& .MuiChip-icon': { color: '#10b981' },
                }}
              />
            )}
          </Box>

          {/* Genres */}
          {data.genres && data.genres.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
              {data.genres.map((genre) => (
                <Chip
                  key={genre}
                  label={genre}
                  size="small"
                  sx={{
                    height: 22,
                    bgcolor: theme.palette.divider,
                    color: '#a1a1aa',
                  }}
                />
              ))}
            </Box>
          )}

          {/* Director / Network */}
          {(data.director || data.network) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {[
                data.director && t('assistantToolUi.directorPrefix', { name: data.director }),
                data.network && t('assistantToolUi.networkPrefix', { name: data.network }),
                data.status,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          )}

          {/* Series info */}
          {data.type === 'series' && (data.seasonCount || data.episodeCount) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('assistantToolUi.seriesCounts', {
                seasons: data.seasonCount ?? 0,
                episodes: data.episodeCount ?? 0,
              })}
              {data.episodesWatched !== undefined &&
                data.episodesWatched > 0 &&
                t('assistantToolUi.episodesWatchedSuffix', { count: data.episodesWatched })}
            </Typography>
          )}

          {/* Action buttons */}
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={<InfoIcon />}
              onClick={handleDetails}
              sx={{
                borderColor: extraColors.subtleBorder,
                color: '#a1a1aa',
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                },
              }}
            >
              {t('assistantToolUi.viewDetails')}
            </Button>
            {playAction && (
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={handlePlay}
                sx={{
                  background: gradients.primaryToSecondary,
                  '&:hover': {
                    background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%)`,
                  },
                }}
              >
                {t('assistantToolUi.playOnEmby')}
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      {/* Overview */}
      {data.overview && (
        <>
          <Divider sx={{ my: 2, borderColor: theme.palette.divider }} />
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            {data.overview}
          </Typography>
        </>
      )}

      {/* Cast */}
      {data.cast && data.cast.length > 0 && (
        <>
          <Divider sx={{ my: 2, borderColor: theme.palette.divider }} />
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            {t('assistantToolUi.castHeading')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {data.cast.join(', ')}
          </Typography>
        </>
      )}
    </Paper>
  )
}

