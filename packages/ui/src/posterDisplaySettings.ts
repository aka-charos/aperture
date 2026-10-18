import { createContext, useContext } from 'react'

export interface PosterDisplaySettings {
  /**
   * Hide the community-rating chip overlaid on library posters. Some media
   * servers burn a rating badge into the artwork itself, making the overlay
   * redundant. Covers from external sources (TMDb) are unaffected.
   */
  hideLibraryRatingBadge: boolean
  /**
   * Tooltip and aria-label for the watched tick. It rides in the context rather
   * than as a prop because this package has no i18n of its own and the badge
   * appears on every poster in the app — a label prop would be the same
   * `t('mediaPoster.watched')` copied into twenty call sites, and the twenty-first
   * would ship untranslated. English default so a bare provider still reads.
   */
  watchedLabel: string
  /**
   * Tooltip for the episode-progress pill. A formatter rather than a string
   * because the counts are interpolated, and a raw template here would put
   * i18n placeholder syntax in a package that has no i18n.
   */
  episodeProgressLabel: (watched: number, total: number) => string
  /**
   * The display name of a genre. Genres are stored as the English names the
   * media server sends and stay that way everywhere data is compared; only
   * what the card prints is translated.
   */
  genreLabel: (genre: string) => string
  /** Text and tooltips for the series watching toggle under the genre line. */
  watchingLabels: {
    add: string
    watching: string
    addTooltip: string
    removeTooltip: string
  }
}

export const defaultPosterDisplaySettings: PosterDisplaySettings = {
  hideLibraryRatingBadge: false,
  watchedLabel: 'Watched',
  episodeProgressLabel: (watched, total) => `${watched} of ${total} episodes watched`,
  genreLabel: (genre) => genre,
  watchingLabels: {
    add: 'Add to Watching',
    watching: 'Watching',
    addTooltip: 'Add to watching list',
    removeTooltip: 'Remove from watching list',
  },
}

export const PosterDisplaySettingsContext = createContext<PosterDisplaySettings>(
  defaultPosterDisplaySettings
)

export function usePosterDisplaySettings(): PosterDisplaySettings {
  return useContext(PosterDisplaySettingsContext)
}
