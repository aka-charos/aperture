import { createContext, useContext } from 'react'

export interface PosterDisplaySettings {
  /**
   * Hide the community-rating chip overlaid on library posters. Some media
   * servers burn a rating badge into the artwork itself, making the overlay
   * redundant. Covers from external sources (TMDb) are unaffected.
   */
  hideLibraryRatingBadge: boolean
}

export const defaultPosterDisplaySettings: PosterDisplaySettings = {
  hideLibraryRatingBadge: false,
}

export const PosterDisplaySettingsContext = createContext<PosterDisplaySettings>(
  defaultPosterDisplaySettings
)

export function usePosterDisplaySettings(): PosterDisplaySettings {
  return useContext(PosterDisplaySettingsContext)
}
