/**
 * Shared "missing season" computation.
 *
 * A season is missing when TMDB says it has aired episodes but the media server
 * holds no episodes for it. Used by both MissingSeasonsCard (the Seerr request
 * banner) and SeasonsList (the season rail) so the two never disagree.
 */

import type { Series, Episode } from './types'

export interface MissingSeason {
  season_number: number
  episode_count: number
}

export function computeMissingSeasons(
  series: Pick<Series, 'tmdb_seasons'>,
  seasons: Record<number, Episode[]>
): MissingSeason[] {
  const today = new Date().toISOString().split('T')[0]
  const serverSeasonNumbers = new Set(Object.keys(seasons).map(Number))
  return (series.tmdb_seasons ?? [])
    .filter(
      (s) =>
        s.season_number >= 1 &&
        s.episode_count > 0 &&
        s.air_date !== null &&
        s.air_date <= today &&
        !serverSeasonNumbers.has(s.season_number)
    )
    .map((s) => ({ season_number: s.season_number, episode_count: s.episode_count }))
}
