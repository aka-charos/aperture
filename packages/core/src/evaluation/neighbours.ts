/**
 * What a title's nearest neighbours actually are, printed so a person can read
 * them.
 *
 * This is the PRIMARY instrument for judging a retrieval change, and the
 * metrics module is the guard rail. That ordering is deliberate. Every offline
 * metric available here is built on a label nobody fully trusts — watched means
 * "got 5% in", favourited means "bookmarked" as often as "loved" — whereas a
 * person who knows twenty films can tell instantly whether Metropolis coming
 * back as Nosferatu and Caligari is better than Metropolis coming back as Das
 * Boot and Cloud Atlas.
 *
 * Country and genre ride along in the output for one specific reason: six of
 * the fifteen fields in `buildCanonicalText` are proper nouns tied to a
 * nationality — director, studio, cinematographer, composer, cast, country —
 * against three that describe what the film is like. If the embedding is
 * partly a nationality detector, it shows up here as a column, immediately.
 */

import { query } from '../lib/db.js'
import { scoreAll, rowAsQuery, type LibraryMatrix } from './embeddingMatrix.js'

export interface NeighbourRow {
  itemId: string
  title: string
  year: number | null
  countries: string[]
  genres: string[]
  cosine: number
}

export interface NeighbourReport {
  seedId: string
  seedTitle: string
  seedYear: number | null
  seedCountries: string[]
  neighbours: NeighbourRow[]
}

export interface TitleFacts {
  title: string
  year: number | null
  countries: string[]
  genres: string[]
}

/** Titles, years, countries and genres for a set of ids, in one round trip. */
export async function fetchTitleFacts(
  mediaType: 'movie' | 'series',
  ids: string[]
): Promise<Map<string, TitleFacts>> {
  const facts = new Map<string, TitleFacts>()
  if (ids.length === 0) return facts

  const table = mediaType === 'movie' ? 'movies' : 'series'
  const result = await query<{
    id: string
    title: string
    year: number | null
    production_countries: string[] | null
    genres: string[] | null
  }>(
    `SELECT id, title, year, production_countries, genres
       FROM ${table} WHERE id = ANY($1)`,
    [ids]
  )

  for (const row of result.rows) {
    facts.set(row.id, {
      title: row.title,
      year: row.year,
      countries: row.production_countries ?? [],
      genres: row.genres ?? [],
    })
  }
  return facts
}

/**
 * Resolve a human-typed title to an id.
 *
 * Deliberately simple: this takes seeds an operator typed into a job argument,
 * so an unmatched name is something they can see and retype. It prefers an
 * exact match and falls back to a prefix, because "Metropolis" should not
 * silently resolve to "Metropolis: Rebuilding a Legacy".
 */
export async function resolveSeedIds(
  mediaType: 'movie' | 'series',
  titles: string[]
): Promise<Array<{ input: string; id: string | null; title?: string; year?: number | null }>> {
  const table = mediaType === 'movie' ? 'movies' : 'series'
  const resolved: Array<{
    input: string
    id: string | null
    title?: string
    year?: number | null
  }> = []

  for (const input of titles) {
    const trimmed = input.trim()
    if (!trimmed) continue

    // unaccent() on both sides, for the reason 0134 records: a `[^a-z0-9]`
    // strip DELETES accented letters rather than folding them, so a film fails
    // to match itself. It matters here specifically because a non-English
    // title is one of the seeds worth stressing a model on, and nobody types
    // "Ascenseur pour l'échafaud" with the accent. STABLE, so it costs the
    // trigram index -- irrelevant for a handful of seeds once per run.
    //
    // The match is a PREFIX, and the settings UI shows which title each seed
    // landed on for exactly that reason: "The Three Musketeers" names four
    // films here and this returns the earliest. The admin preview calls THIS
    // function rather than one of its own, so a preview cannot promise a
    // different film from the one the run will use.
    const result = await query<{ id: string; title: string; year: number | null }>(
      `SELECT id, title, year FROM ${table}
        WHERE unaccent(title) ILIKE unaccent($1)
           OR unaccent(original_title) ILIKE unaccent($1)
        ORDER BY (lower(unaccent(title)) = lower(unaccent($2))) DESC, year ASC NULLS LAST
        LIMIT 1`,
      [`${trimmed}%`, trimmed]
    )
    const hit = result.rows[0]
    resolved.push({
      input: trimmed,
      id: hit?.id ?? null,
      title: hit?.title,
      year: hit?.year ?? null,
    })
  }

  return resolved
}

/**
 * Seeds to use when the operator names none.
 *
 * The titles the most people on this instance have actually finished — which is
 * the property that matters, because the dump is only useful if the reader
 * knows the films well enough to judge whether the neighbours make sense. A
 * "most acclaimed" or "highest rated" default would sample the catalogue
 * instead of the audience and could easily return twelve films nobody here has
 * seen.
 */
export async function popularSeedIds(
  mediaType: 'movie' | 'series',
  limit: number
): Promise<string[]> {
  const result =
    mediaType === 'movie'
      ? await query<{ id: string }>(
          `SELECT wh.movie_id AS id
             FROM watch_history wh
            WHERE wh.movie_id IS NOT NULL AND wh.played = true
            GROUP BY wh.movie_id
            ORDER BY COUNT(DISTINCT wh.user_id) DESC, SUM(wh.play_count) DESC
            LIMIT $1`,
          [limit]
        )
      : await query<{ id: string }>(
          `SELECT e.series_id AS id
             FROM watch_history wh
             JOIN episodes e ON e.id = wh.episode_id
            WHERE wh.played = true
            GROUP BY e.series_id
            ORDER BY COUNT(DISTINCT wh.user_id) DESC, COUNT(*) DESC
            LIMIT $1`,
          [limit]
        )

  return result.rows.map((row) => row.id)
}

/** Top `topN` nearest rows to each seed, excluding the seed itself. */
export function nearestTo(
  matrix: LibraryMatrix,
  seedId: string,
  topN: number,
  scratch: Float64Array
): Array<{ itemId: string; cosine: number }> {
  const seedVector = rowAsQuery(matrix, seedId)
  if (!seedVector) return []

  scoreAll(matrix, seedVector, scratch)

  // Partial selection rather than a full sort: topN is a handful and the pool
  // is the whole library.
  const best: Array<{ itemId: string; cosine: number }> = []
  let floor = -Infinity

  for (let row = 0; row < matrix.ids.length; row++) {
    const itemId = matrix.ids[row]
    if (itemId === seedId) continue

    const cosine = scratch[row]
    if (best.length >= topN && cosine <= floor) continue

    best.push({ itemId, cosine })
    best.sort((a, b) => b.cosine - a.cosine)
    if (best.length > topN) best.pop()
    floor = best[best.length - 1].cosine
  }

  return best
}

export async function buildNeighbourReports(
  mediaType: 'movie' | 'series',
  matrix: LibraryMatrix,
  seedIds: string[],
  topN: number
): Promise<NeighbourReport[]> {
  const scratch = new Float64Array(matrix.ids.length)
  const reports: NeighbourReport[] = []
  const wanted = new Set<string>(seedIds)

  const perSeed = new Map<string, Array<{ itemId: string; cosine: number }>>()
  for (const seedId of seedIds) {
    const nearest = nearestTo(matrix, seedId, topN, scratch)
    perSeed.set(seedId, nearest)
    for (const row of nearest) wanted.add(row.itemId)
  }

  const facts = await fetchTitleFacts(mediaType, [...wanted])

  for (const seedId of seedIds) {
    const seed = facts.get(seedId)
    reports.push({
      seedId,
      seedTitle: seed?.title ?? seedId,
      seedYear: seed?.year ?? null,
      seedCountries: seed?.countries ?? [],
      neighbours: (perSeed.get(seedId) ?? []).map((row) => ({
        itemId: row.itemId,
        title: facts.get(row.itemId)?.title ?? row.itemId,
        year: facts.get(row.itemId)?.year ?? null,
        countries: facts.get(row.itemId)?.countries ?? [],
        genres: facts.get(row.itemId)?.genres ?? [],
        cosine: row.cosine,
      })),
    })
  }

  return reports
}

const pad = (text: string, width: number) =>
  text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)

/**
 * Render one seed's neighbours as fixed-width lines for a job log.
 *
 * Plain text on purpose: this is read in `docker logs` and in the jobs console,
 * both of which are monospaced and neither of which renders anything else.
 */
export function formatNeighbourReport(report: NeighbourReport, label: string): string[] {
  const seedYear = report.seedYear ? ` (${report.seedYear})` : ''
  const seedCountry = report.seedCountries.slice(0, 2).join('/')

  const lines = [
    `${report.seedTitle}${seedYear}  [${seedCountry}]  — ${label}`,
    `     ${pad('title', 38)} ${pad('year', 6)} ${pad('country', 16)} cosine`,
  ]

  report.neighbours.forEach((row, i) => {
    lines.push(
      `  ${String(i + 1).padStart(2)} ${pad(row.title, 38)} ` +
        `${pad(row.year ? String(row.year) : '', 6)} ` +
        `${pad(row.countries.slice(0, 2).join('/'), 16)} ` +
        row.cosine.toFixed(4)
    )
  })

  return lines
}

/**
 * How much of a seed's neighbourhood shares its country.
 *
 * The number that turns "this looks like a nationality detector" into
 * something checkable. Compare it against the country's share of the library:
 * if France is 13% of the catalogue and 70% of a French film's neighbours, the
 * embedding is reporting nationality, not affinity.
 */
export function countryConcentration(report: NeighbourReport): number | null {
  if (report.seedCountries.length === 0 || report.neighbours.length === 0) return null

  const seed = new Set(report.seedCountries)
  const shared = report.neighbours.filter((row) =>
    row.countries.some((country) => seed.has(country))
  ).length

  return shared / report.neighbours.length
}
