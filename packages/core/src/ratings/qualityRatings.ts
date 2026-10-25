/**
 * Computes every title's unified quality rating and stores it on the title
 * (`quality_rating`, `quality_rating_sources`, migration 0213).
 *
 * The rule is unifiedRating.ts. It needs percentiles over the whole table, so
 * it is computed here for a whole table at once and stored, and every reader
 * -- both scorers and the title page -- reads the stored pair through
 * storedQualityRating. Stored rather than computed per request because a title
 * page used to pay a whole-table read for one row, and because a number and its
 * label computed at different times disagreed.
 *
 * WHEN. After every job that changes a rating column (the media server syncs,
 * enrichment, MDBList, refresh-ratings), and before a recommendation run that
 * finds a title not computed yet (ensureQualityRatings) -- which is also what
 * fills the columns the first time, so the regeneration QUALITY_RATING_VERSION
 * triggers scores on the unified rating and not on the fallback.
 *
 * Only rows whose answer changed are written (IS DISTINCT FROM), so a refresh
 * over an unchanged library writes nothing. Writing does not re-embed: embedding
 * staleness reads enriched_at, never updated_at.
 *
 * Never throws (refreshQualityRatingsSafely / ensureQualityRatings): it runs at
 * the end of other jobs and before scoring, and a failure must not fail those.
 * The fallback for a title not computed is the media server's rating, which is
 * what every reader used before this existed.
 */
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { computeUnifiedRatings, type UnifiedRatingMediaType } from './unifiedRating.js'

const logger = createChildLogger('quality-ratings')

/** Rows per UPDATE statement. */
const WRITE_BATCH = 2000

interface RatingRow {
  id: string
  imdb: number | null
  community: number | null
  tmdb: number | null
  rt: number | null
  metacritic: number | null
}

function tableFor(mediaType: UnifiedRatingMediaType): 'movies' | 'series' {
  return mediaType === 'movie' ? 'movies' : 'series'
}

export interface QualityRatingRefresh {
  mediaType: UnifiedRatingMediaType
  titles: number
  written: number
}

/** Compute and store every title's unified rating for one media type. Throws on a database failure. */
export async function refreshQualityRatings(mediaType: UnifiedRatingMediaType): Promise<QualityRatingRefresh> {
  const table = tableFor(mediaType)
  // NUMERIC arrives from pg as a string; float8 arrives as a number.
  const result = await query<RatingRow>(
    `SELECT id,
            imdb_rating::float8      AS imdb,
            community_rating::float8 AS community,
            tmdb_rating::float8      AS tmdb,
            rt_critic_score::float8  AS rt,
            metacritic_score::float8 AS metacritic
       FROM ${table}`
  )
  const computed = computeUnifiedRatings(result.rows, mediaType)

  const entries = [...computed.entries()]
  let written = 0
  for (let start = 0; start < entries.length; start += WRITE_BATCH) {
    const batch = entries.slice(start, start + WRITE_BATCH)
    // Sources travel as comma-joined text: a text[] parameter cannot carry an
    // array per row. The names hold no commas.
    const update = await query(
      `UPDATE ${table} t
          SET quality_rating = d.rating::numeric(4, 2),
              quality_rating_sources = string_to_array(d.sources, ',')
         FROM unnest($1::uuid[], $2::float8[], $3::text[]) AS d(id, rating, sources)
        WHERE t.id = d.id
          AND (t.quality_rating IS DISTINCT FROM d.rating::numeric(4, 2)
               OR t.quality_rating_sources IS DISTINCT FROM string_to_array(d.sources, ','))`,
      [
        batch.map(([id]) => id),
        batch.map(([, r]) => r.rating),
        batch.map(([, r]) => r.sources.join(',')),
      ]
    )
    written += update.rowCount ?? 0
  }
  return { mediaType, titles: entries.length, written }
}

/** refreshQualityRatings for the end of another job: logs and swallows a failure. */
export async function refreshQualityRatingsSafely(mediaType: UnifiedRatingMediaType): Promise<QualityRatingRefresh | null> {
  try {
    const outcome = await refreshQualityRatings(mediaType)
    logger.info(outcome, 'Quality ratings refreshed')
    return outcome
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not refresh quality ratings; titles keep their stored rating')
    return null
  }
}

/**
 * Before scoring: refresh when any title has not been computed yet (a title
 * synced since the last refresh, or none at all). One EXISTS
 * check when everything is current. Never throws; on failure scoring reads
 * whatever is stored, and a title not computed scores on its media server
 * rating.
 */
export async function ensureQualityRatings(mediaType: UnifiedRatingMediaType): Promise<void> {
  try {
    const pending = await queryOne<{ pending: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${tableFor(mediaType)} WHERE quality_rating_sources IS NULL) AS pending`
    )
    if (pending?.pending) await refreshQualityRatingsSafely(mediaType)
  } catch (err) {
    logger.warn({ err, mediaType }, 'Could not check quality ratings; scoring reads what is stored')
  }
}
