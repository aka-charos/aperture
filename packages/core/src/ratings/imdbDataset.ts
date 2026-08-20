/**
 * IMDb ratings, from IMDb's own published dataset.
 *
 * WHY NOT OMDb, WHICH WE ALREADY CALL. Measured on this instance for
 * tt33071426, every figure taken on the same day: OMDb returned 7.2 / 81,611
 * votes, unchanged from what it had returned five days earlier, while IMDb's
 * dataset held 7.1 / 112,851. OMDb was 31,240 votes behind — 28% of the current
 * total — and had the rating wrong by 0.1 as a result.
 *
 * The 0.1 is not a rounding quibble, because the error has a direction. A new
 * release's rating starts high on early-adopter enthusiasm and settles as the
 * vote base widens, so a stale copy systematically OVERRATES recent films. The
 * rating score is a quarter of the recommendation blend at default weights,
 * which makes that a standing thumb on the scale toward new arrivals in a
 * recommender whose whole job is deciding what to surface.
 *
 * Nor is Emby an independent second opinion: the rating-sync plugin that keeps
 * `community_rating` current reads OMDb and MDBList, so it carries the same
 * number by a longer road.
 *
 * WHY A BULK FILE IS THE RIGHT SHAPE HERE, when every other integration in this
 * repo is per-title. `title.ratings.tsv.gz` is 8.2 MB gzipped, refreshed daily,
 * needs no key and has no rate limit — one request covers all ~12.5k titles.
 * The per-title equivalent on OMDb's free tier is 1,000 calls a day, i.e. a
 * thirteen-day trickle for one pass, which can never keep up with a library
 * whose recent releases are the rows that move. So this source needs no TTL, no
 * age-weighting and no budget: refresh everything, daily, for 8 MB.
 *
 * The cost is a licence rather than a quota — IMDb publishes these for personal
 * and non-commercial use — which is why the source is opt-in (see
 * `RatingsRefreshConfig`) rather than simply switched on.
 */
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('imdb-ratings')

export const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz'

/** How many rows go into one UPDATE. Nothing tuned it; it just bounds the arrays. */
const UPDATE_CHUNK = 5000

/** Lines between progress reports and cancellation polls. */
const SCAN_REPORT_INTERVAL = 100_000

/** One usable row of the dataset. */
export interface ImdbRatingRow {
  imdbId: string
  rating: number
  votes: number
}

/**
 * Read one TSV line, keeping it only if we hold that title.
 *
 * Pure, and separated from the streaming for the same reason `pending.ts` and
 * `sourceFloor.ts` are separated from their callers: the interesting behaviour
 * is all in the edge cases, and they should be testable without a network or a
 * database.
 *
 * Three details are deliberate.
 *
 * `indexOf` rather than `split('\t')`, because this runs about 1.5 million
 * times per pass and `split` allocates an array for every line, almost all of
 * which are discarded on the very next check.
 *
 * The `wanted` lookup comes FIRST, immediately after the id is isolated. It is
 * the cheapest discriminator available and it rejects roughly 99% of the file,
 * so nothing else should be parsed ahead of it. It also disposes of the header
 * row for free: `tconst` is not an IMDb id, so it is never in the set.
 *
 * `Number()` rather than `parseFloat`/`parseInt`, because the loose parsers
 * accept trailing garbage — `parseFloat('7.1abc')` is 7.1 — whereas `Number()`
 * rejects the whole string. That also handles IMDb's `\N` null marker with no
 * special case. The one place `Number()` is treacherous is the empty string,
 * which it reads as 0 rather than NaN, so both fields are checked for empty
 * first; without that a truncated line would store a real 0.0 rating, which
 * sorts below genuinely terrible films rather than reading as missing.
 */
export function parseRatingsLine(
  line: string,
  wanted: ReadonlySet<string>
): ImdbRatingRow | null {
  const firstTab = line.indexOf('\t')
  if (firstTab <= 0) return null

  const imdbId = line.slice(0, firstTab)
  if (!wanted.has(imdbId)) return null

  const secondTab = line.indexOf('\t', firstTab + 1)
  if (secondTab < 0) return null

  const ratingText = line.slice(firstTab + 1, secondTab)
  const votesText = line.slice(secondTab + 1)
  if (ratingText === '' || votesText === '') return null

  const rating = Number(ratingText)
  const votes = Number(votesText)
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) return null
  if (!Number.isInteger(votes) || votes < 0) return null

  return { imdbId, rating, votes }
}

export interface ImdbRefreshOptions {
  /** Polled during the scan and between writes; cancellation is cooperative. */
  shouldCancel?: () => boolean
  onProgress?: (progress: { matched: number; wanted: number }) => void
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface ImdbRefreshResult {
  /** Titles we hold that carry an IMDb id — the set we searched the file for. */
  wanted: number
  /** How many of those the dataset actually had. */
  matched: number
  moviesUpdated: number
  seriesUpdated: number
  scannedLines: number
  cancelled: boolean
}

/** Every IMDb id in the library, movies and series together. */
async function loadWantedImdbIds(): Promise<Set<string>> {
  const result = await query<{ imdb_id: string }>(
    `SELECT imdb_id FROM movies WHERE imdb_id IS NOT NULL
     UNION
     SELECT imdb_id FROM series WHERE imdb_id IS NOT NULL`
  )
  return new Set(result.rows.map((r) => r.imdb_id))
}

/**
 * Write one chunk into one table.
 *
 * `imdb_ratings_refreshed_at` is set here as well as in the miss pass, so a row
 * the dataset knew about carries the same stamp as one it did not — the stamp
 * records that the source was consulted, never that it answered.
 */
async function applyChunk(
  table: 'movies' | 'series',
  rows: ImdbRatingRow[],
  runStart: Date
): Promise<number> {
  if (rows.length === 0) return 0
  const result = await query(
    `UPDATE ${table} SET
       imdb_rating = data.rating,
       imdb_vote_count = data.votes,
       imdb_ratings_refreshed_at = $4
     FROM (
       SELECT * FROM unnest($1::text[], $2::numeric[], $3::int[])
         AS t(imdb_id, rating, votes)
     ) AS data
     WHERE ${table}.imdb_id = data.imdb_id`,
    [rows.map((r) => r.imdbId), rows.map((r) => r.rating), rows.map((r) => r.votes), runStart]
  )
  return result.rowCount ?? 0
}

/**
 * Fetch the dataset and apply it to the library.
 *
 * Throws on any transport or decompression failure, which leaves every stamp
 * untouched — a failed pass has to be indistinguishable from one that never
 * ran, or the next run would treat rows this one never reached as checked.
 */
export async function refreshImdbRatings(
  options: ImdbRefreshOptions = {}
): Promise<ImdbRefreshResult> {
  const { shouldCancel, onProgress, onLog } = options
  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    onLog?.(level, message)
    logger[level](message)
  }

  const runStart = new Date()
  const wanted = await loadWantedImdbIds()
  if (wanted.size === 0) {
    log('warn', 'No titles carry an IMDb id - nothing to look up')
    return {
      wanted: 0,
      matched: 0,
      moviesUpdated: 0,
      seriesUpdated: 0,
      scannedLines: 0,
      cancelled: false,
    }
  }

  log('info', `Fetching IMDb ratings dataset for ${wanted.size.toLocaleString()} titles`)

  const response = await fetch(IMDB_RATINGS_URL)
  if (!response.ok || !response.body) {
    throw new Error(`IMDb dataset request failed: HTTP ${response.status}`)
  }

  // Streamed rather than buffered. 8.2 MB compressed is about 40 MB of text and
  // ~1.5 million lines, of which we keep roughly 12,500 - there is no reason to
  // hold any of it, and `response.arrayBuffer()` would hold all of it.
  const download = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)
  const gunzip = createGunzip()
  download.pipe(gunzip)
  // `pipe` does not forward errors, so a mid-download failure would otherwise
  // stall the reader rather than reject it.
  download.on('error', (err) => gunzip.destroy(err))

  const matches: ImdbRatingRow[] = []
  let scannedLines = 0
  let cancelled = false

  const lines = createInterface({ input: gunzip, crlfDelay: Infinity })
  for await (const line of lines) {
    scannedLines++
    const row = parseRatingsLine(line, wanted)
    if (row) matches.push(row)

    if (scannedLines % SCAN_REPORT_INTERVAL === 0) {
      onProgress?.({ matched: matches.length, wanted: wanted.size })
      if (shouldCancel?.()) {
        cancelled = true
        break
      }
    }
  }
  lines.close()
  gunzip.destroy()
  download.destroy()

  onProgress?.({ matched: matches.length, wanted: wanted.size })
  log(
    'info',
    `Scanned ${scannedLines.toLocaleString()} rows, matched ${matches.length.toLocaleString()} titles`
  )

  let moviesUpdated = 0
  let seriesUpdated = 0
  for (let i = 0; i < matches.length; i += UPDATE_CHUNK) {
    const chunk = matches.slice(i, i + UPDATE_CHUNK)
    moviesUpdated += await applyChunk('movies', chunk, runStart)
    seriesUpdated += await applyChunk('series', chunk, runStart)
    if (shouldCancel?.()) {
      cancelled = true
      break
    }
  }

  // Stamp the rows the dataset had nothing for. Skipped on cancellation:
  // the scan stopped early, so rows past that point were never actually looked
  // for, and stamping them would claim a check that did not happen.
  if (!cancelled) {
    const missedMovies = await query(
      `UPDATE movies SET imdb_ratings_refreshed_at = $1
       WHERE imdb_id IS NOT NULL
         AND (imdb_ratings_refreshed_at IS NULL OR imdb_ratings_refreshed_at < $1)`,
      [runStart]
    )
    const missedSeries = await query(
      `UPDATE series SET imdb_ratings_refreshed_at = $1
       WHERE imdb_id IS NOT NULL
         AND (imdb_ratings_refreshed_at IS NULL OR imdb_ratings_refreshed_at < $1)`,
      [runStart]
    )
    const absent = (missedMovies.rowCount ?? 0) + (missedSeries.rowCount ?? 0)
    if (absent > 0) {
      log('info', `${absent.toLocaleString()} titles are not in the dataset yet (no votes)`)
    }
  }

  return {
    wanted: wanted.size,
    matched: matches.length,
    moviesUpdated,
    seriesUpdated,
    scannedLines,
    cancelled,
  }
}
