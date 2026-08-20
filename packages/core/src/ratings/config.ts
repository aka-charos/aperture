/**
 * Which rating sources the refresh job is allowed to use.
 *
 * A per-SOURCE toggle rather than one switch on the job, for two reasons. The
 * sources have genuinely different terms — IMDb publishes its datasets for
 * personal and non-commercial use, which is a decision the operator should make
 * knowingly rather than discover — and they have different failure modes, so
 * turning one off must not silence the others.
 *
 * It is also the surface that answers "why is this column empty". MDBList
 * enrichment on this instance had reached 88 of 12,589 rows and nothing said so
 * anywhere; a card with a row per source and its last run is what makes that
 * visible before someone notices a feature is dead.
 *
 * Stored as one JSON blob and merged over the defaults on read, matching
 * `CrwConfig` — so a blob written before a source existed still returns a
 * complete, well-typed config.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('ratings-config')

const SETTING_KEY = 'ratings_refresh'

/**
 * Every source the refresh job knows about. THE one copy: the config shape, the
 * defaults, the sanitizer and the job's step count are all derived from it, so
 * adding a source is one edit rather than four that have to agree.
 *
 * Deriving the step count matters more than it looks. The executor has to size
 * the progress record before the job reads its own config, and a hand-written
 * constant there is precisely the kind of second copy that silently stops
 * matching — the progress bar would then finish at 50% or run past 100%.
 *
 * - `imdbDataset` — IMDb's published `title.ratings.tsv.gz`. The only source
 *   that is a bulk file rather than an API, and the only one with no quota at
 *   all. Default OFF because of the licence noted above.
 */
export const RATING_SOURCE_IDS = ['imdbDataset'] as const

export type RatingSourceId = (typeof RATING_SOURCE_IDS)[number]

export type RatingsRefreshConfig = Record<RatingSourceId, boolean>

export const DEFAULT_RATINGS_REFRESH_CONFIG: RatingsRefreshConfig = Object.fromEntries(
  RATING_SOURCE_IDS.map((id) => [id, false])
) as RatingsRefreshConfig

/** Anything not explicitly `true` is off — an unknown or malformed blob cannot enable a source. */
function sanitize(config: Partial<RatingsRefreshConfig>): RatingsRefreshConfig {
  return Object.fromEntries(
    RATING_SOURCE_IDS.map((id) => [id, config[id] === true])
  ) as RatingsRefreshConfig
}

export function isRatingSourceId(value: unknown): value is RatingSourceId {
  return typeof value === 'string' && (RATING_SOURCE_IDS as readonly string[]).includes(value)
}

export async function getRatingsRefreshConfig(): Promise<RatingsRefreshConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return sanitize(JSON.parse(json) as Partial<RatingsRefreshConfig>)
    } catch (e) {
      logger.error({ error: e }, 'Failed to parse ratings_refresh config')
    }
  }
  return { ...DEFAULT_RATINGS_REFRESH_CONFIG }
}

export async function setRatingsRefreshConfig(config: RatingsRefreshConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitize(config)),
    'Which rating sources the refresh-ratings job may use'
  )
  logger.info({ config: sanitize(config) }, 'Ratings refresh configuration updated')
}

/** True when at least one source is switched on. */
export function hasEnabledRatingSource(config: RatingsRefreshConfig): boolean {
  return RATING_SOURCE_IDS.some((id) => config[id])
}
