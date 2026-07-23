/**
 * WatchingCard Component
 * 
 * Uses standard MoviePoster with watching-specific info underneath.
 */

import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Box, Typography, Chip, IconButton, Tooltip } from '@mui/material'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import TvIcon from '@mui/icons-material/Tv'
import BookmarkRemoveIcon from '@mui/icons-material/BookmarkRemove'
import { MoviePoster } from '@aperture/ui'
import { useUserRatings } from '@/hooks/useUserRatings'
import { EpisodeAvailabilityBar } from './EpisodeAvailabilityBar'
import type { WatchingSeries, UpcomingEpisode } from '../hooks/useWatchingData'

interface WatchingCardProps {
  series: WatchingSeries
  onRemove: (seriesId: string) => Promise<void>
}

function formatAirDate(dateStr: string, t: TFunction, locale: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('dashboard.airToday')
  if (diffDays === 1) return t('dashboard.airTomorrow')
  if (diffDays > 0 && diffDays <= 7) return t('dashboard.airInDays', { count: diffDays })

  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function formatEpisodeNumber(ep: UpcomingEpisode): string {
  return `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`
}

export function WatchingCard({ series, onRemove }: WatchingCardProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getRating, setRating } = useUserRatings()

  const handleClick = () => {
    navigate(`/series/${series.seriesId}`)
  }

  const handleRate = async (rating: number | null) => {
    try {
      await setRating('series', series.seriesId, rating)
    } catch (err) {
      console.error('Failed to rate series:', err)
    }
  }

  const upcoming = series.upcomingEpisode
  const isAiring = series.status === 'Continuing'
  const showBar = Math.max(series.episodesOnServer, series.episodesAired ?? 0) > 0

  return (
    <Box
      sx={{
        width: '100%',
        // Reveal the remove-from-watchlist action only on hover, like the poster's
        // other overlay controls.
        '&:hover .watching-remove-btn': { opacity: 1 },
      }}
    >
      {/* Standard MoviePoster */}
      <MoviePoster
        title={series.title}
        year={series.year}
        posterUrl={series.posterUrl}
        rating={series.communityRating}
        genres={series.genres}
        overview={series.overview}
        userRating={getRating('series', series.seriesId)}
        onRate={handleRate}
        // The built-in bottom-left toggle is replaced by a distinct hover-revealed
        // remove button (see below) — history-only rows have no watchlist action.
        hideWatchingToggle
        responsive
        onClick={handleClick}
      >
        {/* Status badge */}
        <Chip
          label={isAiring ? t('watching.chipAiringShort') : series.status || t('watching.statusEnded')}
          size="small"
          color={isAiring ? 'success' : 'default'}
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            fontWeight: 600,
            fontSize: '0.7rem',
            zIndex: 3,
          }}
        />

        {/* Remove-from-watchlist — only for watchlist rows; hover-revealed, top-right */}
        {series.inWatchlist && (
          <Tooltip title={t('watching.removeTooltip')} arrow>
            <IconButton
              className="watching-remove-btn"
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(series.seriesId)
              }}
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 4,
                opacity: 0,
                color: '#fff',
                bgcolor: 'rgba(99, 102, 241, 0.95)',
                border: '1.5px solid rgba(255, 255, 255, 0.75)',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(4px)',
                transition: 'opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease',
                '&:hover': {
                  bgcolor: 'error.main',
                  transform: 'scale(1.12)',
                },
              }}
            >
              <BookmarkRemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </MoviePoster>

      {/* Upcoming episode + progress info - below poster */}
      <Box
        sx={{
          mt: 1,
          p: 1,
          borderRadius: 1,
          backgroundColor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          minHeight: showBar ? 70 : 52,
          overflow: 'hidden',
        }}
      >
        {upcoming ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <CalendarTodayIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              <Typography variant="caption" color="primary.main" fontWeight={600}>
                {t('watching.nextEpisodeLabel', {
                  when: formatAirDate(upcoming.airDate, t, i18n.language),
                })}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {formatEpisodeNumber(upcoming)} - {upcoming.title}
            </Typography>
          </>
        ) : isAiring ? (
          <Typography variant="caption" color="text.secondary">
            {t('watching.noUpcomingCard')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TvIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {t('watching.seriesEnded')}
            </Typography>
          </Box>
        )}

        {/* Watched / available / missing in one segmented bar */}
        {showBar && (
          <Box sx={{ mt: 0.75 }}>
            <EpisodeAvailabilityBar series={series} />
          </Box>
        )}
      </Box>
    </Box>
  )
}
