import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Button, Typography, CircularProgress, Grid } from '@mui/material'
import { useAuth } from '../../hooks/useAuth'
import { useCapability } from '../../hooks/useCapability'
import { useWatching } from '../../hooks/useWatching'
import { useConnections } from '../../hooks/useConnections'
import { useOnboarding } from '../../hooks/useOnboarding'
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
  RecommendToDialog,
} from './components'
import { insightsHaveDetail } from './helpers'
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
  const { user, checkAuth } = useAuth()
  // The server's answer, not `isAdmin || canManageWatchHistory` worked out
  // here — that is the admin-override half of a rule whose other half lives
  // in core, and two copies is how they come to disagree.
  const canManageWatchHistory = useCapability('watchHistory:manage')
  const { isWatching, toggleWatching } = useWatching()
  // Decided server-side (the `social` capability): only someone with at least
  // one connection gets a Recommend button.
  const { hasConnections } = useConnections()
  const [recommendOpen, setRecommendOpen] = useState(false)

  const {
    media,
    similar,
    similarLoading,
    insights,
    mediaServer,
    watchStatus,
    watchStats,
    seerrTitleStatus,
    userRating,
    ratingLoading,
    loading,
    error,
    retry,
    seasons,
    seasonAvailability,
    clearWatchStatus,
    setWatchStatusWatched,
    isFavorite,
    favoriteLoading,
    toggleFavorite,
    updateRating,
    refreshExplanation,
  } = useMediaDetail(mediaType, id, user?.id)

  // Rewriting one explanation is a paid model call, so the button is the
  // operator's. The route also allows a viewer's own picks, as the bulk one does.
  const onRefreshExplanation = user?.isAdmin ? refreshExplanation : undefined

  // Reading why a title was scored is one of the getting-started steps, and
  // only the browser sees it happen. The panel draws only for a scored title
  // (`isRecommended`), so that is when it counts.
  const { summary: onboarding, record: recordOnboarding } = useOnboarding()
  const insightsSeen = onboarding?.state.seen?.includes('insights') === true
  const insightsShown = insights?.isRecommended === true
  useEffect(() => {
    if (insightsShown && onboarding && !insightsSeen) recordOnboarding({ seen: ['insights'] })
  }, [insightsShown, onboarding, insightsSeen, recordOnboarding])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  // A 401 is the session ending, not the title: asking again cannot help, so
  // the button re-checks the session — which signs out to the login page, or,
  // when an assumed account's lease ran out, returns to the admin's own view.
  if (error?.kind === 'signedOut') {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography color="error" variant="h6">
          {t('mediaDetail.sessionEnded')}
        </Typography>
        <Button variant="outlined" onClick={() => void checkAuth()} sx={{ mt: 3 }}>
          {t('mediaDetail.sessionContinue')}
        </Button>
      </Box>
    )
  }

  // Only a 404 is "not found". Any other failure is a failure to load, said as
  // such and offered again — it used to read as the title not existing.
  if (error?.kind === 'failed') {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography color="error" variant="h6">
          {t('mediaDetail.loadFailed')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {error.status == null
            ? t('mediaDetail.loadFailedNoAnswer')
            : t('mediaDetail.loadFailedStatus', { status: error.status })}
        </Typography>
        <Button variant="outlined" onClick={retry} sx={{ mt: 3 }}>
          {t('mediaDetail.loadRetry')}
        </Button>
      </Box>
    )
  }

  if (error || !media) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography color="error" variant="h6">
          {mediaType === 'movie' ? t('mediaDetail.movieNotFound') : t('mediaDetail.seriesNotFound')}
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
        // Lets a report about a series name the season it is about. Season 0
        // is specials and is not offered.
        seasonNumbers={Object.keys(seasons)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)}
        // One status call answers for the whole page; the button decides
        // nothing for itself.
        canReportIssue={seerrTitleStatus.canReportIssue}
        // Series-specific
        isWatching={isSeries(media) && id ? isWatching(id) : false}
        onWatchingToggle={isSeries(media) && id ? () => toggleWatching(id) : undefined}
        // Movie-specific
        watchStatus={isMovie(media) ? watchStatus : undefined}
        canManageWatchHistory={canManageWatchHistory}
        userId={user?.id}
        onMarkedUnwatched={isMovie(media) ? clearWatchStatus : undefined}
        onMarkedWatched={isMovie(media) ? setWatchStatusWatched : undefined}
        isFavorite={isFavorite}
        favoriteLoading={favoriteLoading}
        onFavoriteToggle={isMovie(media) && user?.id ? toggleFavorite : undefined}
        onRecommend={hasConnections && id ? () => setRecommendOpen(true) : undefined}
      />

      {id && hasConnections && (
        <RecommendToDialog
          open={recommendOpen}
          mediaType={mediaType}
          itemId={id}
          itemTitle={media.title}
          onClose={() => setRecommendOpen(false)}
        />
      )}

      {/* AI Recommendation Insights — about the READER: why this was picked
          for them, from measured pipeline output.

          Full width only when it has a written explanation, a taste-twin note
          or evidence posters to fill it. A title the run merely scored has
          three percentages and a genre count, which is a column's worth of
          page, not a page's — so that form renders inside the left column
          below. See insightsHaveDetail. */}
      {insights && insightsHaveDetail(insights) && (
        <MovieInsights
          insights={insights}
          mediaType={mediaType}
          onOpenMedia={onOpenMedia}
          onRefreshExplanation={onRefreshExplanation}
        />
      )}

      {/* Main Content */}
      <Box sx={{ mt: 4, px: { xs: 0, sm: 3 } }}>
        <Grid container spacing={3}>
          {/* Left Column - Info */}
          <Grid item xs={12} md={6}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* The scores-only form of the panel above — see the note there. */}
              {insights && !insightsHaveDetail(insights) && (
                <MovieInsights
                  insights={insights}
                  mediaType={mediaType}
                  onOpenMedia={onOpenMedia}
                  onRefreshExplanation={onRefreshExplanation}
                />
              )}
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
                <MissingSeasonsCard
                  series={media}
                  seasonAvailability={seasonAvailability}
                  canRequest={seerrTitleStatus.canRequest}
                />
              )}
              {/* Episodes List (Series only) */}
              {isSeries(media) && Object.keys(seasons).length > 0 && (
                <SeasonsList seasons={seasons} seasonAvailability={seasonAvailability} />
              )}
            </Box>
          </Grid>

          {/* Right Column - Similar */}
          <Grid item xs={12} md={6} data-tour="title-similar">
            <SimilarMedia
              mediaType={mediaType}
              mediaId={id}
              mediaTitle={media.title}
              similar={similar}
              loading={similarLoading}
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

