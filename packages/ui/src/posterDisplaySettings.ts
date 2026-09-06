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
}

export const defaultPosterDisplaySettings: PosterDisplaySettings = {
  hideLibraryRatingBadge: false,
  watchedLabel: 'Watched',
}

export const PosterDisplaySettingsContext = createContext<PosterDisplaySettings>(
  defaultPosterDisplaySettings
)

export function usePosterDisplaySettings(): PosterDisplaySettings {
  return useContext(PosterDisplaySettingsContext)
}
