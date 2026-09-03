/**
 * Discovery Configuration
 *
 * `DiscoveryConfig` declares eleven knobs and, until now, every one of them was
 * a compile-time constant: both entry points passed `DEFAULT_DISCOVERY_CONFIG`
 * verbatim, there was no settings key, no route and no UI. That is out of step
 * with `recommendation_config`, which makes the equivalent recommender knobs
 * admin-tunable per media type, and it meant an operator could not respond to
 * their own instance -- a small library wanting a smaller pool, a large TMDb
 * quota wanting deeper pages, a Trakt-less setup wanting different floors.
 *
 * Stored as one JSON blob in `system_settings` rather than a table, matching
 * the other integration configs (`crw_integration`, `tavily_integration`).
 * There is no per-media-type split, deliberately: unlike the recommender, every
 * knob here is about how much to fetch and how hard to filter, and none of the
 * evidence for splitting them exists yet. Splitting later is additive; merging
 * back is not.
 *
 * Sanitised on both read and write, so a blob written before a field existed
 * still returns a complete config and a hand-edited row cannot put the pipeline
 * into a state the UI could not produce.
 */

import { createChildLogger } from '../lib/logger.js'
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { DEFAULT_DISCOVERY_CONFIG } from './types.js'
import type { DiscoveryConfig } from './types.js'

const logger = createChildLogger('discover:config')

const SETTING_KEY = 'discovery_config'

/**
 * Bounds for every numeric knob.
 *
 * Each maximum is a real limit rather than a round number:
 *
 * - `maxCandidatesPerSource` — TMDb returns 20 per page and the fetchers walk
 *   at most `MAX_PAGES_PER_SOURCE` (10) pages, so 200 is the ceiling the code
 *   can actually reach. A larger number would silently do nothing.
 * - `maxEnrichedCandidates` — each one costs 2 TMDb requests for a movie and 3
 *   for a series, per user, per run. 500 is already a heavy bill.
 * - `maxPoolCandidates` — the merged list is scored in memory per user.
 * - `traktPeriod` is not here; it is a string union validated separately.
 */
export const DISCOVERY_CONFIG_BOUNDS: Record<string, { min: number; max: number }> = {
  maxCandidatesPerSource: { min: 20, max: 200 },
  maxTotalCandidates: { min: 50, max: 5000 },
  maxEnrichedCandidates: { min: 10, max: 500 },
  targetDisplayCount: { min: 10, max: 200 },
  minVoteCount: { min: 0, max: 10000 },
  minVoteAverage: { min: 0, max: 10 },
  similarityWeight: { min: 0, max: 1 },
  popularityWeight: { min: 0, max: 1 },
  recencyWeight: { min: 0, max: 1 },
  maxPoolCandidates: { min: 100, max: 20000 },
  poolMaxAgeDays: { min: 1, max: 365 },
}

const TRAKT_PERIODS: DiscoveryConfig['traktPeriod'][] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'all',
]

/** Clamp one numeric field, falling back to the default when it is unusable. */
function clampNumber(
  key: keyof typeof DISCOVERY_CONFIG_BOUNDS,
  value: unknown,
  fallback: number
): number {
  const bounds = DISCOVERY_CONFIG_BOUNDS[key]

  // Absent is checked BEFORE coercing, because `Number(null)` is 0 and
  // `Number('')` is 0 -- both finite. Coercing first would sail past the
  // Number.isFinite guard below and clamp a missing knob to its MINIMUM rather
  // than restoring its default, which for maxTotalCandidates is the difference
  // between storing 1000 candidates and storing 50.
  if (value === null || value === undefined || value === '') return fallback

  const n = typeof value === 'number' ? value : Number(value)
  // NaN and Infinity resolve to the default too: a hand-edited blob should not
  // be able to put an unusable number into the pipeline.
  if (!Number.isFinite(n)) return fallback

  return Math.min(bounds.max, Math.max(bounds.min, n))
}

/**
 * Coerce a partial, possibly hand-edited blob into a complete valid config.
 *
 * Pure and exported so the bounds are testable without a database.
 */
export function sanitizeDiscoveryConfig(
  partial: Partial<DiscoveryConfig> | null | undefined
): DiscoveryConfig {
  const input = partial ?? {}
  const d = DEFAULT_DISCOVERY_CONFIG

  const config: DiscoveryConfig = {
    maxCandidatesPerSource: clampNumber(
      'maxCandidatesPerSource',
      input.maxCandidatesPerSource,
      d.maxCandidatesPerSource
    ),
    maxTotalCandidates: clampNumber('maxTotalCandidates', input.maxTotalCandidates, d.maxTotalCandidates),
    maxEnrichedCandidates: clampNumber(
      'maxEnrichedCandidates',
      input.maxEnrichedCandidates,
      d.maxEnrichedCandidates
    ),
    targetDisplayCount: clampNumber('targetDisplayCount', input.targetDisplayCount, d.targetDisplayCount),
    minVoteCount: clampNumber('minVoteCount', input.minVoteCount, d.minVoteCount),
    minVoteAverage: clampNumber('minVoteAverage', input.minVoteAverage, d.minVoteAverage),
    similarityWeight: clampNumber('similarityWeight', input.similarityWeight, d.similarityWeight),
    popularityWeight: clampNumber('popularityWeight', input.popularityWeight, d.popularityWeight),
    recencyWeight: clampNumber('recencyWeight', input.recencyWeight, d.recencyWeight),
    traktPeriod: TRAKT_PERIODS.includes(input.traktPeriod as DiscoveryConfig['traktPeriod'])
      ? (input.traktPeriod as DiscoveryConfig['traktPeriod'])
      : d.traktPeriod,
    maxPoolCandidates: clampNumber('maxPoolCandidates', input.maxPoolCandidates, d.maxPoolCandidates),
    poolMaxAgeDays: clampNumber('poolMaxAgeDays', input.poolMaxAgeDays, d.poolMaxAgeDays),
  }

  // Enrichment is a prefix of what gets stored, so enriching more than is kept
  // buys nothing but TMDb requests. Corrected rather than rejected: an admin
  // lowering maxTotalCandidates should not have their save refused because of a
  // field they did not touch.
  if (config.maxEnrichedCandidates > config.maxTotalCandidates) {
    config.maxEnrichedCandidates = config.maxTotalCandidates
  }

  // All three weights at zero would make calculateBaseScore fall back to an
  // unweighted mean, which is a real behaviour but not one anybody chooses on
  // purpose. Restore the defaults rather than serve a silently different blend.
  if (config.similarityWeight + config.popularityWeight + config.recencyWeight <= 0) {
    config.similarityWeight = d.similarityWeight
    config.popularityWeight = d.popularityWeight
    config.recencyWeight = d.recencyWeight
  }

  return config
}

/** The active configuration, or the shipped defaults when none is stored. */
export async function getDiscoveryConfig(): Promise<DiscoveryConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return sanitizeDiscoveryConfig(JSON.parse(json) as Partial<DiscoveryConfig>)
    } catch (err) {
      logger.error({ err }, 'Failed to parse discovery_config; using defaults')
    }
  }
  return { ...DEFAULT_DISCOVERY_CONFIG }
}

/** Persist a configuration, sanitised. Returns what was actually stored. */
export async function setDiscoveryConfig(
  partial: Partial<DiscoveryConfig>
): Promise<DiscoveryConfig> {
  const config = sanitizeDiscoveryConfig(partial)
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(config),
    'Discovery pipeline tuning: fetch sizes, quality floors, scoring weights, pool bounds'
  )
  logger.info({ config }, 'Discovery configuration updated')
  return config
}
