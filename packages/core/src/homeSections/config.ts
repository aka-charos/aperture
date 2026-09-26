/**
 * Home sections configuration: the `home_sections_config` singleton (0173) and
 * the per-feature placement defaults (0175).
 */

import { query, queryOne } from '../lib/db.js'
import {
  DEFAULT_HOME_SECTIONS_CONFIG,
  isHomeSectionSort,
  type HomeSectionsConfig,
  type HomeSectionsConfigUpdate,
} from './settings.js'
import { getFeaturePlacements, saveFeaturePlacements } from './placementStore.js'

interface HomeSectionsConfigRow {
  enabled: boolean
  top_picks_enabled: boolean
  top_picks_without_access: boolean
  recommendations_enabled: boolean
  playlists_enabled: boolean
  top_picks_movies_name: string
  top_picks_series_name: string
  recommendations_movies_name: string
  recommendations_series_name: string
  sort_by: string
  recommendations_limit: number
  updated_at: Date | null
}

type ColumnField = Exclude<keyof HomeSectionsConfigUpdate, 'placements'>

const COLUMN_FOR: Record<ColumnField, string> = {
  enabled: 'enabled',
  topPicksEnabled: 'top_picks_enabled',
  topPicksWithoutAccess: 'top_picks_without_access',
  recommendationsEnabled: 'recommendations_enabled',
  playlistsEnabled: 'playlists_enabled',
  topPicksMoviesName: 'top_picks_movies_name',
  topPicksSeriesName: 'top_picks_series_name',
  recommendationsMoviesName: 'recommendations_movies_name',
  recommendationsSeriesName: 'recommendations_series_name',
  sortBy: 'sort_by',
  recommendationsLimit: 'recommendations_limit',
}

export async function getHomeSectionsConfig(): Promise<HomeSectionsConfig> {
  const [row, placements] = await Promise.all([
    queryOne<HomeSectionsConfigRow>(`SELECT * FROM home_sections_config WHERE id = 1`),
    getFeaturePlacements(),
  ])
  if (!row) return { ...DEFAULT_HOME_SECTIONS_CONFIG, placements }
  return {
    enabled: row.enabled,
    topPicksEnabled: row.top_picks_enabled,
    // Absent on a row read before 0184 ran; absent means the old behaviour.
    topPicksWithoutAccess: row.top_picks_without_access !== false,
    recommendationsEnabled: row.recommendations_enabled,
    playlistsEnabled: row.playlists_enabled,
    topPicksMoviesName: row.top_picks_movies_name,
    topPicksSeriesName: row.top_picks_series_name,
    recommendationsMoviesName: row.recommendations_movies_name,
    recommendationsSeriesName: row.recommendations_series_name,
    // A value edited in SQL to something the server cannot sort by reads as the
    // default rather than being sent to Emby.
    sortBy: isHomeSectionSort(row.sort_by) ? row.sort_by : DEFAULT_HOME_SECTIONS_CONFIG.sortBy,
    recommendationsLimit: row.recommendations_limit,
    placements,
    updatedAt: row.updated_at,
  }
}

/** Apply an already-sanitized update (see `sanitizeHomeSectionsUpdate`). */
export async function updateHomeSectionsConfig(
  update: HomeSectionsConfigUpdate
): Promise<HomeSectionsConfig> {
  const assignments: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(update) as Array<[keyof HomeSectionsConfigUpdate, unknown]>) {
    if (key === 'placements' || value === undefined) continue
    values.push(value)
    assignments.push(`${COLUMN_FOR[key]} = $${values.length}`)
  }

  if (assignments.length > 0) {
    await query(`INSERT INTO home_sections_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
    await query(
      `UPDATE home_sections_config SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = 1`,
      values
    )
  }
  if (update.placements) await saveFeaturePlacements(update.placements)

  return getHomeSectionsConfig()
}
