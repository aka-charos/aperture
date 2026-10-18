import { Box, Grid, Alert } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useAuth } from '@/hooks/useAuth'
import { useConnections } from '@/hooks/useConnections'
import { useDashboardData, useConnectionsRecentWatches } from './hooks'
import { useWatchingData } from '../watching/hooks/useWatchingData'
import {
  QuickStatsBar,
  MediaCarousel,
  WatchingCarousel,
  RecentRatingsList,
  RecentWatchesList,
  ConnectionsRecentWatches,
} from './components'
import { PageHeading } from '@/components/PageHeading'
import { GettingStartedCard } from './components/GettingStartedCard'
import { FeaturedPick } from './components/FeaturedPick'
import { useOpenMedia } from '@/hooks/useOpenMedia'
import { MediaDetailModalProvider } from '@/hooks/MediaDetailModalProvider'

export function DashboardPage() {
  // The dashboard is for browsing: a title opens over the page, so closing it
  // returns the reader to the row they were in instead of sending them back.
  return (
    <MediaDetailModalProvider>
      <DashboardContent />
    </MediaDetailModalProvider>
  )
}

function DashboardContent() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data, loading, error } = useDashboardData()
  const { series: watchingSeries, loading: watchingLoading } = useWatchingData()
  const { hasConnections } = useConnections()
  const { users: connectionUsers, loading: connectionsLoading } =
    useConnectionsRecentWatches(hasConnections)

  // Upcoming episodes soonest first, then shows whose latest episode aired
  // recently (nothing upcoming soon), newest first. Both windows are decided
  // by the API; the two fields never both carry a value.
  const upcomingShows = watchingSeries
    .filter((s) => s.upcomingEpisode)
    .sort(
      (a, b) =>
        new Date(a.upcomingEpisode!.airDate).getTime() -
        new Date(b.upcomingEpisode!.airDate).getTime()
    )
  const recentlyAiredShows = watchingSeries
    .filter((s) => !s.upcomingEpisode && s.recentlyAiredEpisode)
    .sort(
      (a, b) =>
        new Date(b.recentlyAiredEpisode!.airDate).getTime() -
        new Date(a.recentlyAiredEpisode!.airDate).getTime()
    )
  const episodeShows = [...upcomingShows, ...recentlyAiredShows]

  const greeting = getGreeting(t)
  const openMedia = useOpenMedia()

  // The first recommendation of each kind is featured above the rows, so each
  // row starts at its second pick, numbered as it ranks (2, 3, …).
  const movieRecs = (data?.recommendations || []).filter((item) => item.type === 'movie')
  const seriesRecs = (data?.recommendations || []).filter((item) => item.type === 'series')
  const featured = [movieRecs[0], seriesRecs[0]].filter((item): item is NonNullable<typeof item> => Boolean(item))
  const ranked = (items: typeof movieRecs) =>
    items.slice(1).map((item, index) => ({ ...item, rank: index + 2 }))

  return (
    <Box>
      <PageHeading
        title={`${greeting}, ${user?.displayName || user?.username || ''}`}
        description={t('dashboard.subtitle')}
        sx={{ mb: 3 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <GettingStartedCard />

      {/* Quick Stats: one line */}
      <Box sx={{ mb: 3 }} data-tour="home-stats">
        <QuickStatsBar
          moviesWatched={data?.stats.moviesWatched || 0}
          seriesWatched={data?.stats.seriesWatched || 0}
          ratingsCount={data?.stats.ratingsCount || 0}
          watchTimeMinutes={data?.stats.watchTimeMinutes || 0}
          windowDays={data?.stats.windowDays}
          loading={loading}
        />
      </Box>

      {/* The top pick of each kind, led by its poster */}
      {!loading && <FeaturedPick picks={featured} onOpen={(item) => openMedia(item.type, item.id)} />}

      {/* Your AI Movie Recommendations */}
      <Box sx={{ mb: 4 }} data-tour="home-rows">
        <MediaCarousel
          title={t('dashboard.aiMovieRecommendations')}
          subtitle={t('dashboard.subtitlePersonalized')}
          items={ranked(movieRecs)}
          loading={loading}
          showScore
          showRank
          // With a single pick it is the featured one, and the row has nothing
          // to add: say nothing rather than "no recommendations".
          emptyMessage={movieRecs.length > 0 ? '' : t('dashboard.emptyMovieRecs')}
        />
      </Box>

      {/* Your AI Series Recommendations */}
      <Box sx={{ mb: 4 }}>
        <MediaCarousel
          title={t('dashboard.aiSeriesRecommendations')}
          subtitle={t('dashboard.subtitlePersonalized')}
          items={ranked(seriesRecs)}
          loading={loading}
          showScore
          showRank
          emptyMessage={seriesRecs.length > 0 ? '' : t('dashboard.emptySeriesRecs')}
          // Recommendations are shows to try, not shows being followed yet.
          hideWatchingToggle
        />
      </Box>

      {/* Shows You Watch - New & Upcoming Episodes */}
      {(watchingLoading || episodeShows.length > 0) && (
        <Box sx={{ mb: 4 }}>
          <WatchingCarousel
            // The key keeps its old name although the row now also holds
            // recently aired shows: an admin's override of the title
            // (Translations, or /config/i18n) is keyed on it and would be
            // stranded by a rename. All 14 locales carry the new wording.
            title={t('dashboard.upcomingEpisodes')}
            subtitle={t('dashboard.subtitleFromWatching')}
            items={episodeShows}
            loading={watchingLoading}
          />
        </Box>
      )}

      {/* Top Pick Movies */}
      <Box sx={{ mb: 4 }}>
        <MediaCarousel
          title={t('dashboard.topPickMovies')}
          subtitle={t('dashboard.subtitlePopularMovies')}
          items={(data?.topPicks || []).filter(item => item.type === 'movie')}
          loading={loading}
          showRank
          emptyMessage={t('dashboard.emptyTrendingMovies')}
        />
      </Box>

      {/* Top Pick Series */}
      <Box sx={{ mb: 4 }}>
        <MediaCarousel
          title={t('dashboard.topPickSeries')}
          subtitle={t('dashboard.subtitlePopularSeries')}
          items={(data?.topPicks || []).filter(item => item.type === 'series')}
          loading={loading}
          showRank
          emptyMessage={t('dashboard.emptyTrendingSeries')}
        />
      </Box>

      {/* What the viewer's connections watched lately: under Top Picks, above
          the recent-activity lists. Not at the very bottom, where it was
          ~3,000px down and read as missing. Each slider carries its own bottom
          margin. */}
      {hasConnections && (
        <ConnectionsRecentWatches users={connectionUsers} loading={connectionsLoading} />
      )}

      {/* Bottom section: Recent Watches + Recent Ratings */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <RecentWatchesList
            watches={data?.recentWatches || []}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <RecentRatingsList
            ratings={data?.recentRatings || []}
            loading={loading}
          />
        </Grid>
      </Grid>
    </Box>
  )
}

function getGreeting(t: TFunction): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('dashboard.greetingMorning')
  if (hour < 17) return t('dashboard.greetingAfternoon')
  return t('dashboard.greetingEvening')
}

