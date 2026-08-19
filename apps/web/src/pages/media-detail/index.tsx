import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Typography, CircularProgress, Grid } from '@mui/material'
import { useAuth } from '../../hooks/useAuth'
import { useWatching } from '../../hooks/useWatching'
import { useMediaDetail } from './hooks'
import {
  MediaBackdrop,
  MediaHero,
  MediaInfoCard,
  SeasonsList,
  MissingSeasonsCard,
  SimilarMedia,
  MovieInsights,
  TitleAnalysis,
} from './components'
import { isMovie, isSeries } from './types'
import type { MediaType } from './types'

interface MediaDetailPageProps {
  mediaType: MediaType
  /**
   * Item to show. Defaults to the route param — this is a routed page, but it is
   * also rendered inside MediaDetailModal, where there is no route to read.
   */
  id?: string
  /** Replaces the back arrow's default history pop (the modal host closes itself). */
  onBack?: () => void
  /**
   * When set, related titles and recommendation evidence open through this
   * instead of routing — inside the modal, routing would move the page
   * underneath it and strand the user when they close the dialog.
   */
  onOpenMedia?: (mediaType: MediaType, id: string) => void
}

export function MediaDetailPage({
  mediaType,
  id: idProp,
  onBack,
  onOpenMedia,
}: MediaDetailPageProps) {
  const { t } = useTranslation()
  const { id: routeId } = useParams<{ id: string }>()
  const id = idProp ?? routeId
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isWatching, toggleWatching } = useWatching()

  const {
    media,
    similar,
    insights,
    mediaServer,
    watchStatus,
    watchStats,
    userRating,
    ratingLoading,
    loading,
    error,
    seasons,
    seasonAvailability,
    clearWatchStatus,
    setWatchStatusWatched,
    isFavorite,
    favoriteLoading,
    toggleFavorite,
    updateRating,
  } = useMediaDetail(mediaType, id, user?.id)

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !media) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography color="error" variant="h6">
          {error ||
            (mediaType === 'movie' ? t('mediaDetail.movieNotFound') : t('mediaDetail.seriesNotFound'))}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      {/* Backdrop */}
      <MediaBackdrop
        backdropUrl={media.backdrop_url}
        title={media.title}
        onBack={onBack ?? (() => navigate(-1))}
      />

      {/* Hero Section */}
      <MediaHero
        media={media}
        mediaServer={mediaServer}
        userRating={userRating}
        ratingLoading={ratingLoading}
        onRatingChange={updateRating}
        // Styles the genre chips as enjoyed / new to explore. Undefined until
        // the insights request lands, and for any title no run has scored.
        genreAnalysis={insights?.genreAnalysis}
        // Community watch counts. These render as a line in the hero now
        // rather than as a card in the info card below.
        watchStats={watchStats}
        // Series-specific
        isWatching={isSeries(media) && id ? isWatching(id) : false}
        onWatchingToggle={isSeries(media) && id ? () => toggleWatching(id) : undefined}
        // Movie-specific
        watchStatus={isMovie(media) ? watchStatus : undefined}
        canManageWatchHistory={user?.isAdmin || user?.canManageWatchHistory || false}
        userId={user?.id}
        onMarkedUnwatched={isMovie(media) ? clearWatchStatus : undefined}
        onMarkedWatched={isMovie(media) ? setWatchStatusWatched : undefined}
        isFavorite={isFavorite}
        favoriteLoading={favoriteLoading}
        onFavoriteToggle={isMovie(media) && user?.id ? toggleFavorite : undefined}
      />

      {/* AI Recommendation Insights — about the READER: why this was picked
          for them, from measured pipeline output. */}
      {insights && (
        <MovieInsights insights={insights} mediaType={mediaType} onOpenMedia={onOpenMedia} />
      )}

      {/* Main Content */}
      <Box sx={{ mt: 4, px: { xs: 2, sm: 3 } }}>
        <Grid container spacing={3}>
          {/* Left Column - Info */}
          <Grid item xs={12} md={6}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Grounded critical analysis — about the WORK, identical for
                  every user, written from web sources. Below the personal
                  panel because a reader who came here from their
                  recommendations wants "why me" first, and inside this column
                  rather than spanning the page: it is prose, and prose set to
                  the full width of a desktop window has no right edge to line
                  up with and a line nobody can track. */}
              {id && <TitleAnalysis mediaType={mediaType} mediaId={id} />}
              <MediaInfoCard media={media} />
              {/* Aired episodes missing from the server + Seerr requests (series only) */}
              {isSeries(media) && (
                <MissingSeasonsCard series={media} seasonAvailability={seasonAvailability} />
              )}
              {/* Episodes List (Series only) */}
              {isSeries(media) && Object.keys(seasons).length > 0 && (
                <SeasonsList seasons={seasons} seasonAvailability={seasonAvailability} />
              )}
            </Box>
          </Grid>

          {/* Right Column - Similar */}
          <Grid item xs={12} md={6}>
            <SimilarMedia
              mediaType={mediaType}
              mediaId={id}
              mediaTitle={media.title}
              similar={similar}
              onOpenMedia={onOpenMedia}
            />
          </Grid>
        </Grid>
      </Box>

      {/* Bottom padding */}
      <Box sx={{ pb: 4 }} />
    </Box>
  )
}

// Export convenience wrappers for routes
export function MovieDetailPage() {
  return <MediaDetailPage mediaType="movie" />
}

export function SeriesDetailPage() {
  return <MediaDetailPage mediaType="series" />
}

