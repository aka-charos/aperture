import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Typography, useTheme } from '@mui/material'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { MoviePoster, BaseCarousel, CarouselItem } from '@aperture/ui'
import { useUserRatings } from '../../../hooks/useUserRatings'
import { useWatchStatus } from '../../../hooks/useWatchStatus'
import { useWatching } from '../../../hooks/useWatching'
import { MediaTypeChip } from '../../../components/MediaTypeChip'
import { useDashboardPosterMinWidth } from '../posterSize'

interface MediaItem {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  matchScore?: number | null
  rank?: number
}

interface MediaCarouselProps {
  title: string
  subtitle?: string
  items: MediaItem[]
  loading?: boolean
  showScore?: boolean
  showRank?: boolean
  emptyMessage?: string
  rows?: 1 | 2
  /**
   * Label each poster Movie or Series, for a row that mixes the two. Shares
   * the top-left corner with the rank badge, so never set it with `showRank`.
   */
  showMediaType?: boolean
  /**
   * Leave the watching toggle off series posters. For a row whose shows the
   * viewer is choosing among rather than following, the button is noise.
   */
  hideWatchingToggle?: boolean
}

export function MediaCarousel({
  title,
  subtitle,
  items,
  loading,
  showScore = false,
  showRank = false,
  emptyMessage: emptyMessageProp,
  rows = 1,
  showMediaType = false,
  hideWatchingToggle = false,
}: MediaCarouselProps) {
  const { t } = useTranslation()
  const emptyMessage = emptyMessageProp ?? t('dashboard.carouselEmpty')
  const posterMinWidth = useDashboardPosterMinWidth()
  const openMedia = useOpenMedia()
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  const { isWatching, toggleWatching } = useWatching()

  const handleRate = useCallback(
    async (type: 'movie' | 'series', id: string, rating: number | null) => {
      try {
        await setRating(type, id, rating)
      } catch (err) {
        console.error('Failed to rate:', err)
      }
    },
    [setRating]
  )

  const handleItemClick = (item: MediaItem) => {
    openMedia(item.type, item.id)
  }

  // Rank and match sit under the poster, not on it: the server's own art
  // often carries its own badges (flags, ratings) in exactly those corners.
  const renderPoster = (item: MediaItem) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <MoviePoster
      title={item.title}
      year={item.year}
      posterUrl={item.posterUrl}
      genres={item.genres}
      showScore={false}
      userRating={getRating(item.type, item.id)}
      watched={isWatched(item.type, item.id)}
      episodeProgress={getEpisodeProgress(item.type, item.id)}
      onRate={(rating) => handleRate(item.type, item.id, rating)}
      isWatching={item.type === 'series' ? isWatching(item.id) : undefined}
      onWatchingToggle={item.type === 'series' ? () => toggleWatching(item.id) : undefined}
      hideWatchingToggle={hideWatchingToggle || item.type !== 'series'}
      onClick={() => handleItemClick(item)}
      size="medium"
      // Fills the slot the carousel sized (fitItems), so a row always ends on
      // a whole poster rather than a slice of the next.
      responsive
    >
      {showMediaType && !showRank && <MediaTypeChip type={item.type} />}
    </MoviePoster>
    {(showRank || showScore) && (
      <PosterFooter
        rank={showRank ? item.rank : undefined}
        match={showScore ? (item.matchScore ?? null) : null}
        highlight={showScore}
      />
    )}
    </Box>
  )

  if (rows === 2) {
    // Two-row layout: split items into pairs for vertical stacking
    return (
      <BaseCarousel
        title={title}
        subtitle={subtitle}
        loading={loading}
        emptyMessage={emptyMessage}
        hasItems={items.length > 0}
        fitItems
        itemMinWidth={posterMinWidth}
      >
        {Array.from({ length: Math.ceil(items.length / 2) }).map((_, colIndex) => {
          const topItem = items[colIndex * 2]
          const bottomItem = items[colIndex * 2 + 1]
          return (
            <CarouselItem key={colIndex}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {topItem && <Box sx={{ position: 'relative' }}>{renderPoster(topItem)}</Box>}
                {bottomItem && <Box sx={{ position: 'relative' }}>{renderPoster(bottomItem)}</Box>}
              </Box>
            </CarouselItem>
          )
        })}
      </BaseCarousel>
    )
  }

  // Single-row layout
  return (
    <BaseCarousel
      title={title}
      subtitle={subtitle}
      loading={loading}
      emptyMessage={emptyMessage}
      hasItems={items.length > 0}
      fitItems
      itemMinWidth={posterMinWidth}
    >
      {items.map((item) => (
        <CarouselItem key={`${item.type}-${item.id}`}>
          {renderPoster(item)}
        </CarouselItem>
      ))}
    </BaseCarousel>
  )
}

/** How many of a recommendations row's first ranks are drawn in the accent. */
const HIGHLIGHTED_RANKS = 3

/**
 * Under a poster on a ranked row: its place, and for a recommendation how
 * well it matches, as a meter. `highlight`: the first ranks wear the accent
 * (recommendations); a popularity row keeps every rank neutral.
 */
function PosterFooter({ rank, match, highlight }: { rank?: number; match: number | null; highlight: boolean }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const accentRank = highlight && rank != null && rank <= HIGHLIGHTED_RANKS
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {rank != null && (
        <Box
          aria-label={t('dashboard.rankLabel', { rank })}
          role="img"
          sx={{
            flex: '0 0 auto',
            minWidth: 24,
            height: 24,
            px: 0.75,
            boxSizing: 'border-box',
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            bgcolor: accentRank ? 'primary.main' : alpha(theme.palette.text.primary, 0.1),
            color: accentRank ? 'primary.contrastText' : 'text.primary',
          }}
        >
          {rank}
        </Box>
      )}
      {match != null && (
        <Box
          role="img"
          aria-label={t('dashboard.featured.match', { score: match })}
          sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.1) }}>
            <Box sx={{ height: 4, borderRadius: 2, width: `${Math.max(0, Math.min(100, match))}%`, bgcolor: 'primary.main' }} />
          </Box>
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'primary.light' }}>
            {match}%
          </Typography>
        </Box>
      )}
    </Box>
  )
}
