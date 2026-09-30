import type { SetupStepId } from './types'

// Default library cover images (bundled with the app). Read by the admin Top
// Picks section as well, so they stay here although the wizard no longer asks
// for covers.
export const DEFAULT_LIBRARY_IMAGES: Record<string, string> = {
  'ai-recs-movies': '/AI_MOVIE_PICKS.png',
  'ai-recs-series': '/AI_SERIES_PICKS.png',
  'top-picks-movies': '/TOP_10_MOVIES_THIS_WEEK.png',
  'top-picks-series': '/TOP_10_SERIES_THIS_WEEKpng.png',
  'watching': '/Shows_You_Watch.png',
}

/**
 * Ordered step ids; labels use `setup.step.<id>.label` in i18n.
 *
 * The three steps that sat between Libraries and Users — file locations, the
 * STRM-or-symlink choice and the mount checks — were all for legacy library
 * output and are gone (F-142). A resumed wizard whose stored progress still
 * names them simply never finds them here, which is harmless.
 */
export const STEP_ORDER_IDS: SetupStepId[] = [
  'restoreFromBackup',
  'mediaServer',
  'mediaLibraries',
  'users',
  'topPicks',
  'aiSetup',
  'initialJobs',
  'complete',
]

export const DEFAULT_TOP_PICKS = {
  isEnabled: false,
}

export const DEFAULT_MEDIA_SERVER_TYPES = [
  { id: 'emby', name: 'Emby' },
  { id: 'jellyfin', name: 'Jellyfin' },
]

