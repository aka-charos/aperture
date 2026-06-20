/**
 * Expand a channel's recommendation pool using the Web Search role.
 *
 * For the channel's seed (example) movies, ask the grounding-capable Web Search model for
 * similar titles, then keep only the ones we actually own (resolved against the local library).
 * This surfaces franchise / director / thematic neighbours that pure embedding similarity can
 * miss. Entirely additive and best-effort: returns [] when the Web Search role is unconfigured,
 * there are no seeds, or nothing new resolves — generation then behaves exactly as before.
 */
import { generateObject, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { getWebSearchModelInstance, getWebSearchProviderTools } from '../lib/ai-provider.js'
import type { ChannelRecommendation } from './types.js'

const logger = createChildLogger('channels-web-expand')

const CandidateSchema = z.object({
  title: z.string(),
  year: z.number().int().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
})
type WebCandidate = z.infer<typeof CandidateSchema>

interface Seed {
  title: string
  year: number | null
}

interface LibraryRow {
  id: string
  title: string
  year: number | null
  provider_item_id: string | null
  imdb_id: string | null
  tmdb_id: string | null
  content_rating: string | null
}

const RESOLVE_COLUMNS = 'id, title, year, provider_item_id, imdb_id, tmdb_id, content_rating'

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A matched row's title must plausibly agree with the candidate before we trust an ID hit. */
function titlesAgree(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return true
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * Web-search for movies similar to each seed (grounded), then structure them into candidates.
 */
async function gatherSimilarCandidates(
  seeds: Seed[],
  textPreferences: string | null,
  genres: string[]
): Promise<WebCandidate[]> {
  let model: LanguageModel
  try {
    model = await getWebSearchModelInstance()
  } catch {
    // Web Search role not configured — expansion is simply off.
    return []
  }

  const seedList = seeds.map((s) => (s.year ? `${s.title} (${s.year})` : s.title)).join('; ')
  const prefLine = textPreferences?.trim()
    ? `\nViewer preferences to honour: ${textPreferences.trim()}`
    : ''
  const genreLine = genres.length ? `\nLean toward these genres: ${genres.join(', ')}` : ''

  try {
    const tools = await getWebSearchProviderTools()

    // Pass 1 — grounded similar-title suggestions per seed
    const pass1 = await generateText({
      model,
      tools,
      prompt:
        'Using current web information, recommend movies that are SIMILAR to each of the seed movies below — ' +
        'same franchise or director, or strongly comparable in theme, tone and style. ' +
        'Give about 4-6 similar movies for EACH seed. For each, state the exact title and release year. ' +
        'Include an IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.' +
        prefLine +
        genreLine +
        `\n\nSeed movies: ${seedList}`,
    })

    const { text } = pass1
    const grounding = (
      pass1.providerMetadata?.google as
        | { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: unknown[] } }
        | undefined
    )?.groundingMetadata
    logger.info(
      {
        seeds: seeds.length,
        webSearchQueries: grounding?.webSearchQueries ?? [],
        sources: pass1.sources?.length ?? 0,
      },
      'Channel web expansion: grounding completed'
    )

    if (!text?.trim()) return []

    // Pass 2 — structure into typed candidates (no grounding needed)
    const { object } = await generateObject({
      model,
      schema: z.object({ candidates: z.array(CandidateSchema).max(60) }),
      prompt:
        'Extract the movies mentioned below into structured candidates. ' +
        'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id.\n\n' +
        text,
    })

    return object.candidates
  } catch (err) {
    logger.warn({ err }, 'Channel web expansion gathering failed; skipping')
    return []
  }
}

/**
 * Match web candidates to in-library movies. Only movies we actually own (provider_item_id
 * present), not watched, not already chosen, and within the owner's parental limit are returned.
 * Tiered: imdb_id → tmdb_id → title+year (±1).
 */
async function resolveToLibraryMovies(
  candidates: WebCandidate[],
  excludeMovieIds: Set<string>,
  watchedIds: Set<string>,
  maxParentalRating: number | null,
  limit: number
): Promise<ChannelRecommendation[]> {
  if (candidates.length === 0) return []

  // Rating-name → numeric value lookup for the parental cap
  const ratingMap = new Map<string, number>()
  if (maxParentalRating !== null) {
    const rv = await query<{ rating_name: string; rating_value: number }>(
      'SELECT rating_name, rating_value FROM parental_rating_values'
    )
    for (const r of rv.rows) ratingMap.set(r.rating_name, r.rating_value)
  }

  const matched: ChannelRecommendation[] = []
  const seen = new Set<string>(excludeMovieIds)
  const pending = [...candidates]

  const accept = (row: LibraryRow, cand: WebCandidate): boolean => {
    if (!row.provider_item_id) return false
    if (seen.has(row.id) || watchedIds.has(row.id)) return false
    if (cand.year && row.year && Math.abs(row.year - cand.year) > 1) return false
    if (maxParentalRating !== null && row.content_rating) {
      const value = ratingMap.get(row.content_rating) ?? 0
      if (value > maxParentalRating) return false
    }
    seen.add(row.id)
    matched.push({
      movieId: row.id,
      providerItemId: row.provider_item_id,
      title: row.title,
      year: row.year,
      score: 0.5,
    })
    return true
  }

  // Tier 1 — imdb_id (exact)
  const imdbIds = pending.map((c) => c.imdbId).filter((x): x is string => !!x)
  if (imdbIds.length) {
    const res = await query<LibraryRow>(
      `SELECT ${RESOLVE_COLUMNS} FROM movies WHERE imdb_id = ANY($1::text[])`,
      [imdbIds]
    )
    for (let i = pending.length - 1; i >= 0; i--) {
      const cand = pending[i]
      if (!cand.imdbId) continue
      const row = res.rows.find((r) => !!r.imdb_id && r.imdb_id === cand.imdbId)
      if (row && titlesAgree(row.title, cand.title) && accept(row, cand)) pending.splice(i, 1)
    }
  }

  // Tier 2 — tmdb_id (exact) for the still-unmatched
  const tmdbIds = pending.map((c) => c.tmdbId).filter((x): x is string => !!x)
  if (tmdbIds.length) {
    const res = await query<LibraryRow>(
      `SELECT ${RESOLVE_COLUMNS} FROM movies WHERE tmdb_id = ANY($1::text[])`,
      [tmdbIds]
    )
    for (let i = pending.length - 1; i >= 0; i--) {
      const cand = pending[i]
      if (!cand.tmdbId) continue
      const row = res.rows.find((r) => !!r.tmdb_id && r.tmdb_id === cand.tmdbId)
      if (row && titlesAgree(row.title, cand.title) && accept(row, cand)) pending.splice(i, 1)
    }
  }

  // Tier 3 — residual: title ILIKE + year (±1), exact-title preferred
  for (const cand of pending) {
    if (matched.length >= limit) break
    const res = await query<LibraryRow>(
      `SELECT ${RESOLVE_COLUMNS} FROM movies
       WHERE title ILIKE $1
       ORDER BY CASE WHEN LOWER(title) = LOWER($2) THEN 0 ELSE 1 END, ABS(COALESCE(year, 0) - $3)
       LIMIT 5`,
      [`%${cand.title}%`, cand.title, cand.year ?? 0]
    )
    const row = res.rows.find(
      (r) =>
        !seen.has(r.id) &&
        !watchedIds.has(r.id) &&
        !!r.provider_item_id &&
        (!cand.year || !r.year || Math.abs(r.year - cand.year) <= 1)
    )
    if (row) accept(row, cand)
  }

  return matched.slice(0, limit)
}

/**
 * Expand a channel's recommendation pool with in-library movies the web considers similar to
 * the channel's seed movies. `existing` is excluded so we only add net-new titles.
 */
export async function gatherWebExpansion(
  channelId: string,
  existing: ChannelRecommendation[],
  limit = 20
): Promise<ChannelRecommendation[]> {
  const channel = await queryOne<{
    owner_id: string
    genre_filters: string[] | null
    text_preferences: string | null
    example_movie_ids: string[] | null
    max_parental_rating: number | null
  }>(
    `SELECT c.owner_id, c.genre_filters, c.text_preferences, c.example_movie_ids, u.max_parental_rating
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  )

  if (!channel || !channel.example_movie_ids?.length) return []

  const seedRows = await query<Seed>('SELECT title, year FROM movies WHERE id = ANY($1)', [
    channel.example_movie_ids,
  ])
  if (seedRows.rows.length === 0) return []

  const candidates = await gatherSimilarCandidates(
    seedRows.rows,
    channel.text_preferences,
    channel.genre_filters ?? []
  )
  if (candidates.length === 0) return []

  const watched = await query<{ movie_id: string }>(
    'SELECT movie_id FROM watch_history WHERE user_id = $1',
    [channel.owner_id]
  )
  const watchedIds = new Set(watched.rows.map((r) => r.movie_id))
  const excludeIds = new Set(existing.map((r) => r.movieId))

  const extras = await resolveToLibraryMovies(
    candidates,
    excludeIds,
    watchedIds,
    channel.max_parental_rating,
    limit
  )

  logger.info(
    { channelId, candidates: candidates.length, added: extras.length },
    'Channel web expansion resolved'
  )

  return extras
}
