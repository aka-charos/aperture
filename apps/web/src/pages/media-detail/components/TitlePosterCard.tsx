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
