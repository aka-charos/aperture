import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { MoviePoster } from '@aperture/ui'
import { useUserRatings } from '../../../hooks/useUserRatings'
import { useWatchStatus } from '../../../hooks/useWatchStatus'
import { useWatching } from '../../../hooks/useWatching'
import type { MediaType } from '../types'

/**
 * The grid both tabs of a title's right column draw their posters in. Tracks
 * come from the container, not the viewport: this column is often much
 * narrower than the window (the docked assistant, the detail dialog). 130px,
 * not 150: two 150px tracks plus the gap did not fit a phone.
 */
export const TITLE_POSTER_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: 2,
} as const

/**
 * A card still loading, drawn by the poster itself so its title lines always
 * match the loaded card's.
 */
function TitlePosterPlaceholder() {
  return <MoviePoster title="" loading responsive />
}

/**
 * Placeholder cards for a grid whose count is not known yet: only the first
 * row shows (later rows collapse to nothing), so it fills as many cards as the
 * row fits and promises no number. Enough cards for the widest column.
 */
export function TitlePosterPlaceholderRow() {
  return (
    <Box
      aria-busy
      sx={{ ...TITLE_POSTER_GRID_SX, rowGap: 0, gridAutoRows: 0, gridTemplateRows: 'auto', overflow: 'hidden' }}
    >
      {Array.from({ length: PLACEHOLDER_ROW_FILL }, (_, i) => (
        <TitlePosterPlaceholder key={i} />
      ))}
    </Box>
  )
}

/** More than the widest right column fits in a row (half of a very wide window at 130px a card). */
const PLACEHOLDER_ROW_FILL = 12

interface TitlePosterCardProps {
  mediaType: MediaType
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  genres?: string[]
  onOpen: () => void
  /** Drawn under the poster: why this title is here. */
  children?: ReactNode
}

/**
 * One title in the right column of a title's page, the same card in Related
 * and in Next from here: the viewer's rating, watched tick or episode count,
 * and for a show the watching toggle.
 */
export function TitlePosterCard({ mediaType, id, title, year, posterUrl, genres, onOpen, children }: TitlePosterCardProps) {
  const { getRating, setRating } = useUserRatings()
  const { isWatched, getEpisodeProgress } = useWatchStatus()
  const { isWatching, toggleWatching } = useWatching()
  const isSeries = mediaType === 'series'

  return (
    <Box>
      <MoviePoster
        title={title}
        year={year}
        posterUrl={posterUrl}
        titleRef={{ mediaType, id }}
        genres={genres}
        userRating={getRating(mediaType, id)}
        watched={isWatched(mediaType, id)}
        episodeProgress={getEpisodeProgress(mediaType, id)}
        onRate={(rating) => {
          setRating(mediaType, id, rating).catch((err: unknown) => console.error('Failed to rate:', err))
        }}
        isWatching={isSeries ? isWatching(id) : undefined}
        onWatchingToggle={isSeries ? () => toggleWatching(id) : undefined}
        hideWatchingToggle={!isSeries}
        responsive
        onClick={onOpen}
      />
      {children}
    </Box>
  )
}
