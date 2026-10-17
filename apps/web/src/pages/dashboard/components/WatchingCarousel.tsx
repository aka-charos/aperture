import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Box, Typography, Chip } from '@mui/material'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import NewReleasesIcon from '@mui/icons-material/NewReleases'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { useDashboardPosterMinWidth } from '../posterSize'
import { MoviePoster, BaseCarousel, CarouselItem } from '@aperture/ui'
import { useUserRatings } from '../../../hooks/useUserRatings'
import { useWatchStatus } from '../../../hooks/useWatchStatus'

interface UpcomingEpisode {
  seasonNumber: number
  episodeNumber: number
  title: string
  airDate: string
}

interface WatchingItem {
  id: string
  seriesId: string
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  overview: string | null
  communityRating: number | null
  status: string | null
  upcomingEpisode: UpcomingEpisode | null
  /** Set by the API only when upcomingEpisode is not: the latest episode aired recently */
  recentlyAiredEpisode: UpcomingEpisode | null
}

interface WatchingCarouselProps {
  title: string
  subtitle?: string
  items: WatchingItem[]
  loading?: boolean
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
  })
}

/** A past air date, as a short date. Date-only strings are read as UTC by `new Date`, so format in UTC too or a date shifts a day west of Greenwich. */
function formatAiredDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatEpisodeNumber(ep: UpcomingEpisode): string {
  return `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`
}

/** The line under a poster: when (upcoming or aired) on the left, SxxEyy on the right. */
function EpisodeLine({
  icon: Icon,
  color,
  label,
  episode,
}: {
  icon: typeof CalendarTodayIcon
  color: string
  label: string
  episode: UpcomingEpisode
}) {
  return (
    <Box
      sx={{
        mt: 1,
        p: 0.75,
        borderRadius: 1,
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Icon sx={{ fontSize: 12, color }} />
        <Typography variant="caption" color={color} fontWeight={600}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {formatEpisodeNumber(episode)}
        </Typography>
      </Box>
    </Box>
  )
}

export function WatchingCarousel({
  title,
  subtitle,
  items,
  loading,
}: WatchingCarouselProps) {
  const { t, i18n } = useTranslation()
  const openMedia = useOpenMedia()
  const posterMinWidth = useDashboardPosterMinWidth()
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()

  const handleRate = useCallback(
    async (id: string, rating: number | null) => {
      try {
        await setRating('series', id, rating)
      } catch (err) {
        console.error('Failed to rate:', err)
      }
    },
    [setRating]
  )

  const handleItemClick = (item: WatchingItem) => {
    openMedia('series', item.seriesId)
  }

  // Don't render if no items (carousel handles empty state internally but we want to hide completely)
  if (!loading && items.length === 0) {
    return null
  }

  return (
    <BaseCarousel
      title={title}
      subtitle={subtitle}
      loading={loading}
      hasItems={items.length > 0}
      fitItems
      itemMinWidth={posterMinWidth}
    >
      {items.map((item) => (
        <CarouselItem key={item.id}>
          <MoviePoster
            title={item.title}
            year={item.year}
            posterUrl={item.posterUrl}
            rating={item.communityRating}
            genres={item.genres}
            overview={item.overview}
            userRating={getRating('series', item.seriesId)}
            watched={isWatched('series', item.seriesId)}
            episodeProgress={getEpisodeProgress('series', item.seriesId)}
            onRate={(rating) => handleRate(item.seriesId, rating)}
            // No watching toggle: every show in this row is here because the
            // viewer is watching it, so the button could only ever say so.
            size="medium"
            // Fills the slot the carousel sized (fitItems).
            responsive
            onClick={() => handleItemClick(item)}
          >
            {/* Status badge */}
            {item.status === 'Continuing' && (
              <Chip
                label={t('dashboard.chipAiring')}
                size="small"
                color="success"
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  fontWeight: 600,
                  fontSize: '0.65rem',
                  height: 20,
                  zIndex: 3,
                }}
              />
            )}
          </MoviePoster>

          {item.upcomingEpisode ? (
            <EpisodeLine
              icon={CalendarTodayIcon}
              color="primary.main"
              label={formatAirDate(item.upcomingEpisode.airDate, t, i18n.language)}
              episode={item.upcomingEpisode}
            />
          ) : item.recentlyAiredEpisode ? (
            // Latest episode, when it aired recently and nothing is upcoming
            <EpisodeLine
              icon={NewReleasesIcon}
              color="success.main"
              label={t('dashboard.airedOn', {
                date: formatAiredDate(item.recentlyAiredEpisode.airDate, i18n.language),
              })}
              episode={item.recentlyAiredEpisode}
            />
          ) : null}
        </CarouselItem>
      ))}
    </BaseCarousel>
  )
}
