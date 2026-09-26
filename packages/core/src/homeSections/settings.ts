/**
 * What an operator can configure about managed home sections, and the rules a
 * saved value must satisfy. Pure — no database, no media server — so the save
 * route and the tests read the same rules.
 */

import {
  DEFAULT_FEATURE_PLACEMENT,
  PLACEMENT_FEATURES,
  isPlacementFeature,
  sanitizeFeaturePlacement,
  type FeaturePlacement,
  type PlacementFeature,
} from './placement.js'

export { MAX_SECTION_POSITION } from './placement.js'

/**
 * Server-side sort fields offered for a tag-backed row. A tag carries no order,
 * so this is the only ordering a row can have; there is deliberately no "rank"
 * option, because nothing on the server could honour one.
 */
export const HOME_SECTION_SORTS = [
  'Random',
  'SortName',
  'DateCreated',
  'ProductionYear',
  'PremiereDate',
  'CommunityRating',
] as const

export type HomeSectionSort = (typeof HOME_SECTION_SORTS)[number]

export function isHomeSectionSort(value: unknown): value is HomeSectionSort {
  return typeof value === 'string' && (HOME_SECTION_SORTS as readonly string[]).includes(value)
}

/**
 * The direction that goes with each field, decided here rather than offered as a
 * second setting: newest, most recent and best-rated first, titles A–Z.
 */
export function sortOrderFor(sort: HomeSectionSort): 'Ascending' | 'Descending' {
  return sort === 'Random' || sort === 'SortName' ? 'Ascending' : 'Descending'
}

export const MAX_ROW_NAME_LENGTH = 100
export const MIN_RECOMMENDATIONS_LIMIT = 1
export const MAX_RECOMMENDATIONS_LIMIT = 100

export interface HomeSectionsConfig {
  enabled: boolean
  /** Both Top Picks rows. */
  topPicksEnabled: boolean
  /**
   * Whether the Top Picks rows also reach accounts without access here. On by
   * default, which is how Top Picks always behaved (0184).
   */
  topPicksWithoutAccess: boolean
  /** Both recommendation rows (movies and series). */
  recommendationsEnabled: boolean
  /** Whether viewers may put their own generated playlists on their home screen. */
  playlistsEnabled: boolean
  topPicksMoviesName: string
  topPicksSeriesName: string
  recommendationsMoviesName: string
  recommendationsSeriesName: string
  sortBy: HomeSectionSort
  recommendationsLimit: number
  /** Where each feature's rows go unless a viewer chose otherwise. */
  placements: Record<PlacementFeature, FeaturePlacement>
  updatedAt: Date | null
}

export const DEFAULT_HOME_SECTIONS_CONFIG: HomeSectionsConfig = {
  enabled: false,
  topPicksEnabled: true,
  topPicksWithoutAccess: true,
  recommendationsEnabled: true,
  playlistsEnabled: true,
  topPicksMoviesName: 'Top Picks: Movies',
  topPicksSeriesName: 'Top Picks: Series',
  recommendationsMoviesName: 'Recommended Movies',
  recommendationsSeriesName: 'Recommended Series',
  sortBy: 'Random',
  recommendationsLimit: 20,
  placements: Object.fromEntries(
    PLACEMENT_FEATURES.map((feature) => [feature, DEFAULT_FEATURE_PLACEMENT])
  ) as Record<PlacementFeature, FeaturePlacement>,
  updatedAt: null,
}

export type HomeSectionsConfigUpdate = Partial<
  Pick<
    HomeSectionsConfig,
    | 'enabled'
    | 'topPicksEnabled'
    | 'topPicksWithoutAccess'
    | 'recommendationsEnabled'
    | 'playlistsEnabled'
    | 'topPicksMoviesName'
    | 'topPicksSeriesName'
    | 'recommendationsMoviesName'
    | 'recommendationsSeriesName'
    | 'sortBy'
    | 'recommendationsLimit'
  >
> & { placements?: Partial<Record<PlacementFeature, FeaturePlacement>> }

const BOOLEAN_FIELDS = [
  'enabled',
  'topPicksEnabled',
  'topPicksWithoutAccess',
  'recommendationsEnabled',
  'playlistsEnabled',
] as const
const NAME_FIELDS = [
  'topPicksMoviesName',
  'topPicksSeriesName',
  'recommendationsMoviesName',
  'recommendationsSeriesName',
] as const

/**
 * Turn a request body into an update, collecting a reason for every value that
 * was PROVIDED and invalid. Absent fields are left alone; an invalid one is an
 * error rather than silently clamped, so the page and the database never
 * disagree about what was saved.
 */
export function sanitizeHomeSectionsUpdate(body: unknown): {
  update: HomeSectionsConfigUpdate
  errors: string[]
} {
  const update: HomeSectionsConfigUpdate = {}
  const errors: string[] = []
  if (typeof body !== 'object' || body === null) return { update, errors: ['Body must be an object'] }
  const input = body as Record<string, unknown>

  for (const field of BOOLEAN_FIELDS) {
    if (input[field] === undefined) continue
    if (typeof input[field] === 'boolean') update[field] = input[field]
    else errors.push(`${field} must be a boolean`)
  }

  for (const field of NAME_FIELDS) {
    if (input[field] === undefined) continue
    const value = typeof input[field] === 'string' ? input[field].trim() : ''
    if (value.length > 0 && value.length <= MAX_ROW_NAME_LENGTH) update[field] = value
    else errors.push(`${field} must be 1–${MAX_ROW_NAME_LENGTH} characters`)
  }

  if (input.recommendationsLimit !== undefined) {
    const value = input.recommendationsLimit
    if (
      Number.isInteger(value) &&
      (value as number) >= MIN_RECOMMENDATIONS_LIMIT &&
      (value as number) <= MAX_RECOMMENDATIONS_LIMIT
    ) {
      update.recommendationsLimit = value as number
    } else {
      errors.push(
        `recommendationsLimit must be a whole number from ${MIN_RECOMMENDATIONS_LIMIT} to ${MAX_RECOMMENDATIONS_LIMIT}`
      )
    }
  }

  if (input.sortBy !== undefined) {
    if (isHomeSectionSort(input.sortBy)) update.sortBy = input.sortBy
    else errors.push(`sortBy must be one of ${HOME_SECTION_SORTS.join(', ')}`)
  }

  if (input.placements !== undefined) {
    if (typeof input.placements !== 'object' || input.placements === null) {
      errors.push('placements must be an object')
    } else {
      const placements: Partial<Record<PlacementFeature, FeaturePlacement>> = {}
      for (const [feature, value] of Object.entries(input.placements as Record<string, unknown>)) {
        if (!isPlacementFeature(feature)) {
          errors.push(`placements.${feature} is not a feature`)
          continue
        }
        const result = sanitizeFeaturePlacement(value, `placements.${feature}`)
        if (result.placement) placements[feature] = result.placement
        errors.push(...result.errors)
      }
      if (Object.keys(placements).length > 0) update.placements = placements
    }
  }

  return { update, errors }
}
