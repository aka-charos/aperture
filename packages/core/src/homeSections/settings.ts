/**
 * What an operator can configure about managed home sections, and the rules a
 * saved value must satisfy. Pure — no database, no media server — so the save
 * route and the tests read the same rules.
 */

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

export const MAX_SECTION_POSITION = 50
export const MAX_ROW_NAME_LENGTH = 100
export const MIN_RECOMMENDATIONS_LIMIT = 1
export const MAX_RECOMMENDATIONS_LIMIT = 100

export interface HomeSectionsConfig {
  enabled: boolean
  topPicksEnabled: boolean
  recommendationsEnabled: boolean
  /** Whether viewers may put their own generated playlists on their home screen. */
  playlistsEnabled: boolean
  sectionPosition: number
  /** The position the last full sync applied; null until one has. */
  appliedSectionPosition: number | null
  topPicksMoviesName: string
  topPicksSeriesName: string
  recommendationsName: string
  sortBy: HomeSectionSort
  recommendationsLimit: number
  updatedAt: Date | null
}

export const DEFAULT_HOME_SECTIONS_CONFIG: HomeSectionsConfig = {
  enabled: false,
  topPicksEnabled: true,
  recommendationsEnabled: true,
  playlistsEnabled: true,
  sectionPosition: 0,
  appliedSectionPosition: null,
  topPicksMoviesName: 'Top Picks: Movies',
  topPicksSeriesName: 'Top Picks: Series',
  recommendationsName: 'Recommended for You',
  sortBy: 'Random',
  recommendationsLimit: 20,
  updatedAt: null,
}

export type HomeSectionsConfigUpdate = Partial<
  Pick<
    HomeSectionsConfig,
    | 'enabled'
    | 'topPicksEnabled'
    | 'recommendationsEnabled'
    | 'playlistsEnabled'
    | 'sectionPosition'
    | 'topPicksMoviesName'
    | 'topPicksSeriesName'
    | 'recommendationsName'
    | 'sortBy'
    | 'recommendationsLimit'
  >
>

const BOOLEAN_FIELDS = ['enabled', 'topPicksEnabled', 'recommendationsEnabled', 'playlistsEnabled'] as const
const NAME_FIELDS = ['topPicksMoviesName', 'topPicksSeriesName', 'recommendationsName'] as const

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

  if (input.sectionPosition !== undefined) {
    const value = input.sectionPosition
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SECTION_POSITION) {
      update.sectionPosition = value as number
    } else {
      errors.push(`sectionPosition must be a whole number from 0 to ${MAX_SECTION_POSITION}`)
    }
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

  return { update, errors }
}
