/**
 * Shows You Watch Module
 *
 * Per-user list in `user_watching_series`, upcoming episode helpers,
 * and bidirectional sync with media server series favorites (Emby/Jellyfin).
 */

export {
  getUpcomingEpisodes,
  getUpcomingEpisodeForSeries,
  getLatestAiredEpisodes,
  type UpcomingEpisode,
} from './upcomingEpisodes.js'

export {
  UPCOMING_EPISODE_HORIZON_MONTHS,
  RECENTLY_AIRED_WINDOW_MONTHS,
  upcomingHorizonDate,
  recentlyAiredSinceDate,
  isWithinUpcomingHorizon,
  isRecentlyAired,
  pickLatestAired,
  type AiredEpisode,
} from './episodeWindows.js'

export { refreshStaleTmdbTotals } from './tmdbTotals.js'

export {
  reconcileWatchingFavoritesForUser,
  favoriteWatchingSeriesOnMediaServer,
  unfavoriteWatchingSeriesOnMediaServer,
  processWatchingFavoritesForAllUsers,
  type ReconcileWatchingFavoritesResult,
} from './favoriteSync.js'

export {
  getWatchStatusForUser,
  movieFinishedSql,
  seriesFinishedSql,
  type WatchStatusForUser,
  type SeriesWatchProgress,
} from './watchedItems.js'
