/**
 * Home sections configuration: the `home_sections_config` singleton (0173).
 */

import { query, queryOne } from '../lib/db.js'
import {
  DEFAULT_HOME_SECTIONS_CONFIG,
  isHomeSectionSort,
  type HomeSectionsConfig,
  type HomeSectionsConfigUpdate,
} from './settings.js'

interface HomeSectionsConfigRow {
  enabled: boolean
  top_picks_enabled: boolean
  recommendations_enabled: boolean
  playlists_enabled: boolean
  section_position: number
  applied_section_position: number | null
  top_picks_movies_name: string
  top_picks_series_name: string
  recommendations_name: string
  sort_by: string
  recommendations_limit: number
  updated_at: Date | null
}

const COLUMN_FOR: Record<keyof HomeSectionsConfigUpdate, string> = {
  enabled: 'enabled',
  topPicksEnabled: 'top_picks_enabled',
  recommendationsEnabled: 'recommendations_enabled',
  playlistsEnabled: 'playlists_enabled',
  sectionPosition: 'section_position',
  topPicksMoviesName: 'top_picks_movies_name',
  topPicksSeriesName: 'top_picks_series_name',
  recommendationsName: 'recommendations_name',
  sortBy: 'sort_by',
  recommendationsLimit: 'recommendations_limit',
}

function mapRow(row: HomeSectionsConfigRow): HomeSectionsConfig {
  return {
    enabled: row.enabled,
    topPicksEnabled: row.top_picks_enabled,
    recommendationsEnabled: row.recommendations_enabled,
    playlistsEnabled: row.playlists_enabled,
    sectionPosition: row.section_position,
    appliedSectionPosition: row.applied_section_position,
    topPicksMoviesName: row.top_picks_movies_name,
    topPicksSeriesName: row.top_picks_series_name,
    recommendationsName: row.recommendations_name,
    // A value edited in SQL to something the server cannot sort by reads as the
    // default rather than being sent to Emby.
    sortBy: isHomeSectionSort(row.sort_by) ? row.sort_by : DEFAULT_HOME_SECTIONS_CONFIG.sortBy,
    recommendationsLimit: row.recommendations_limit,
    updatedAt: row.updated_at,
  }
}

export async function getHomeSectionsConfig(): Promise<HomeSectionsConfig> {
  const row = await queryOne<HomeSectionsConfigRow>(`SELECT * FROM home_sections_config WHERE id = 1`)
  return row ? mapRow(row) : { ...DEFAULT_HOME_SECTIONS_CONFIG }
}

/** Apply an already-sanitized update (see `sanitizeHomeSectionsUpdate`). */
export async function updateHomeSectionsConfig(
  update: HomeSectionsConfigUpdate
): Promise<HomeSectionsConfig> {
  const assignments: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(update) as Array<[keyof HomeSectionsConfigUpdate, unknown]>) {
    if (value === undefined) continue
    values.push(value)
    assignments.push(`${COLUMN_FOR[key]} = $${values.length}`)
  }

  if (assignments.length > 0) {
    await query(
      `INSERT INTO home_sections_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
    )
    await query(
      `UPDATE home_sections_config SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = 1`,
      values
    )
  }

  return getHomeSectionsConfig()
}

/** Record the position a complete sync applied to every viewer. */
export async function markSectionPositionApplied(position: number): Promise<void> {
  await query(`UPDATE home_sections_config SET applied_section_position = $1 WHERE id = 1`, [position])
}
