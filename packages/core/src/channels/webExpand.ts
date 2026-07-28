/**
 * Expand a channel's recommendation pool using the Web Search role.
 *
 * For the channel's seed (example) titles, ask the grounding-capable Web Search model for
 * similar ones, then keep only the ones we actually own (resolved against the local library).
 * This surfaces franchise / creator / thematic neighbours that pure embedding similarity can
 * miss. Entirely additive and best-effort: returns [] when the Web Search role is unconfigured,
 * there are no seeds, or nothing new resolves — generation then behaves exactly as before.
 *
 * Media types follow the channel: a movie-only channel gets movies, a series-only channel gets
 * shows, a mixed channel can get both.
 */
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { createChildLogger } from '../lib/logger.js'
import { query, queryOne } from '../lib/db.js'
import { withWebSearchModel, getWebSearchProviderTools } from '../lib/ai-provider.js'
import { parseChannelMediaTypes } from './recommendations.js'
import type { ChannelMediaType, ChannelRecommendation } from './types.js'

const logger = createChildLogger('channels-web-expand')

const CandidateSchema = z.object({
  title: z.string(),
  year: z.number().int().optional(),
  /** The model's own guess at what this is; only used to decide which table to try first. */
  type: z.enum(['movie', 'show']).optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
})
type WebCandidate = z.infer<typeof CandidateSchema>

interface Seed {
  title: string
  year: number | null
  mediaType: ChannelMediaType
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

const MEDIA_TABLES: Record<ChannelMediaType, string> = {
  movie: 'movies',
  series: 'series',
}

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

/** Human wording for the media the channel wants, used in the grounding prompt. */
function describeWanted(mediaTypes: ChannelMediaType[]): string {
  const wantsMovies = mediaTypes.includes('movie')
  const wantsSeries = mediaTypes.includes('series')
  if (wantsMovies && wantsSeries) return 'movies and TV series'
  return wantsSeries ? 'TV series' : 'movies'
}

/**
 * Web-search for titles similar to each seed (grounded), then structure them into candidates.
 */
async function gatherSimilarCandidates(
  seeds: Seed[],
  mediaTypes: ChannelMediaType[],
  textPreferences: string | null,
  genres: string[]
): Promise<WebCandidate[]> {
  const seedList = seeds
    .map((s) => {
      const label = s.year ? `${s.title} (${s.year})` : s.title
      return s.mediaType === 'series' ? `${label} [TV series]` : label
    })
    .join('; ')
  const prefLine = textPreferences?.trim()
    ? `\nViewer preferences to honour: ${textPreferences.trim()}`
    : ''
  const genreLine = genres.length ? `\nLean toward these genres: ${genres.join(', ')}` : ''
  const wanted = describeWanted(mediaTypes)

  try {
    const tools = await getWebSearchProviderTools()

    // Both passes run on the same key, and both count against its quota, so the
    // whole thing sits inside withWebSearchModel: a 429 on either pass restarts
    // on the fallback key rather than losing the expansion entirely.
    return await withWebSearchModel<WebCandidate[]>(async (model) => {
      // Pass 1 — grounded similar-title suggestions per seed
      const pass1 = await generateText({
        model,
        tools,
        prompt:
          `Using current web information, recommend ${wanted} that are SIMILAR to each of the seed titles below — ` +
          'same franchise or creator/director, or strongly comparable in theme, tone and style. ' +
          `Recommend ONLY ${wanted}. ` +
          `Give about 4-6 similar titles for EACH seed. For each, state the exact title, release year, ` +
          'and whether it is a movie or a TV series. ' +
          'Include an IMDb id (tt…) or TMDb id ONLY if it appears in a source you actually used; otherwise omit it.' +
          prefLine +
          genreLine +
          `\n\nSeed titles: ${seedList}`,
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
          mediaTypes,
          webSearchQueries: grounding?.webSearchQueries ?? [],
          sources: pass1.sources?.length ?? 0,
        },
        'Channel web expansion: grounding completed'
      )

      if (!text?.trim()) return { value: [], usage: pass1.usage }

      // Pass 2 — structure into typed candidates (no grounding needed)
      const pass2 = await generateObject({
        model,
        schema: z.object({ candidates: z.array(CandidateSchema).max(60) }),
        prompt:
          'Extract the titles mentioned below into structured candidates. ' +
          'Set type to "movie" or "show" based on what the text says it is. ' +
          'Set imdbId/tmdbId ONLY if explicitly present in the text — never guess or invent an id.\n\n' +
          text,
      })

      return {
        value: pass2.object.candidates,
        usage: {
          inputTokens: (pass1.usage.inputTokens ?? 0) + (pass2.usage.inputTokens ?? 0),
          outputTokens: (pass1.usage.outputTokens ?? 0) + (pass2.usage.outputTokens ?? 0),
          totalTokens: (pass1.usage.totalTokens ?? 0) + (pass2.usage.totalTokens ?? 0),
        },
      }
    })
  } catch (err) {
    // Includes "Web Search role not configured" — expansion is simply off then.
    logger.warn({ err }, 'Channel web expansion gathering failed; skipping')
    return []
  }
}

/**
 * Which library tables to try for a candidate, and in what order: the model's own movie/show guess
 * goes first, but a wrong guess still resolves as long as the channel allows the other type.
 */
function resolutionOrder(
  candidate: WebCandidate,
  mediaTypes: ChannelMediaType[]
): ChannelMediaType[] {
  const guess: ChannelMediaType | null =
    candidate.type === 'show' ? 'series' : candidate.type === 'movie' ? 'movie' : null
  if (!guess || !mediaTypes.includes(guess)) return mediaTypes
  return [guess, ...mediaTypes.filter((t) => t !== guess)]
}

/**
 * Match web candidates to in-library items. Only titles we actually own (provider_item_id
 * present), not watched, not already chosen, and within the owner's parental limit are returned.
 * Tiered: imdb_id → tmdb_id → title+year (±1), each tier tried across the channel's media types.
 */
async function resolveToLibraryItems(
  candidates: WebCandidate[],
  mediaTypes: ChannelMediaType[],
  excludeIds: Set<string>,
  watchedIdsByType: Record<ChannelMediaType, Set<string>>,
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
  const seen = new Set<string>(excludeIds)
  const pending = [...candidates]

  const accept = (row: LibraryRow, cand: WebCandidate, mediaType: ChannelMediaType): boolean => {
    if (!row.provider_item_id) return false
    if (seen.has(row.id) || watchedIdsByType[mediaType].has(row.id)) return false
    if (cand.year && row.year && Math.abs(row.year - cand.year) > 1) return false
    if (maxParentalRating !== null && row.content_rating) {
      const value = ratingMap.get(row.content_rating) ?? 0
      if (value > maxParentalRating) return false
    }
    seen.add(row.id)
    matched.push({
      mediaType,
      itemId: row.id,
      providerItemId: row.provider_item_id,
      title: row.title,
      year: row.year,
      score: 0.5,
    })
    return true
  }

  // Tier 1 — imdb_id (exact), Tier 2 — tmdb_id (exact) for the still-unmatched
  for (const tier of ['imdbId', 'tmdbId'] as const) {
    const column = tier === 'imdbId' ? 'imdb_id' : 'tmdb_id'
    const ids = pending.map((c) => c[tier]).filter((x): x is string => !!x)
    if (ids.length === 0) continue

    // One query per allowed table, then match candidates against whichever table hit.
    const rowsByType = new Map<ChannelMediaType, LibraryRow[]>()
    for (const mediaType of mediaTypes) {
      const res = await query<LibraryRow>(
        `SELECT ${RESOLVE_COLUMNS} FROM ${MEDIA_TABLES[mediaType]} WHERE ${column} = ANY($1::text[])`,
        [ids]
      )
      rowsByType.set(mediaType, res.rows)
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      const cand = pending[i]
      const candId = cand[tier]
      if (!candId) continue
      for (const mediaType of resolutionOrder(cand, mediaTypes)) {
        const row = (rowsByType.get(mediaType) ?? []).find(
          (r) => !!r[column] && r[column] === candId
        )
        if (row && titlesAgree(row.title, cand.title) && accept(row, cand, mediaType)) {
          pending.splice(i, 1)
          break
        }
      }
    }
  }

  // Tier 3 — residual: title ILIKE + year (±1), exact-title preferred
  for (const cand of pending) {
    if (matched.length >= limit) break
    for (const mediaType of resolutionOrder(cand, mediaTypes)) {
      const res = await query<LibraryRow>(
        `SELECT ${RESOLVE_COLUMNS} FROM ${MEDIA_TABLES[mediaType]}
         WHERE title ILIKE $1
         ORDER BY CASE WHEN LOWER(title) = LOWER($2) THEN 0 ELSE 1 END, ABS(COALESCE(year, 0) - $3)
         LIMIT 5`,
        [`%${cand.title}%`, cand.title, cand.year ?? 0]
      )
      const row = res.rows.find(
        (r) =>
          !seen.has(r.id) &&
          !watchedIdsByType[mediaType].has(r.id) &&
          !!r.provider_item_id &&
          (!cand.year || !r.year || Math.abs(r.year - cand.year) <= 1)
      )
      if (row && accept(row, cand, mediaType)) break
    }
  }

  return matched.slice(0, limit)
}

/**
 * Expand a channel's recommendation pool with in-library titles the web considers similar to
 * the channel's seeds. `existing` is excluded so we only add net-new items.
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
    example_series_ids: string[] | null
    media_types: string[] | null
    max_parental_rating: number | null
  }>(
    `SELECT c.owner_id, c.genre_filters, c.text_preferences, c.example_movie_ids,
            c.example_series_ids, c.media_types, u.max_parental_rating
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  )

  if (!channel) return []

  const mediaTypes = parseChannelMediaTypes(channel.media_types)
  const seeds: Seed[] = []

  if (channel.example_movie_ids?.length) {
    const rows = await query<{ title: string; year: number | null }>(
      'SELECT title, year FROM movies WHERE id = ANY($1)',
      [channel.example_movie_ids]
    )
    seeds.push(...rows.rows.map((r) => ({ ...r, mediaType: 'movie' as const })))
  }

  if (channel.example_series_ids?.length) {
    const rows = await query<{ title: string; year: number | null }>(
      'SELECT title, year FROM series WHERE id = ANY($1)',
      [channel.example_series_ids]
    )
    seeds.push(...rows.rows.map((r) => ({ ...r, mediaType: 'series' as const })))
  }

  if (seeds.length === 0) return []

  const candidates = await gatherSimilarCandidates(
    seeds,
    mediaTypes,
    channel.text_preferences,
    channel.genre_filters ?? []
  )
  if (candidates.length === 0) return []

  const watchedIdsByType: Record<ChannelMediaType, Set<string>> = {
    movie: new Set<string>(),
    series: new Set<string>(),
  }

  if (mediaTypes.includes('movie')) {
    const watched = await query<{ movie_id: string }>(
      'SELECT movie_id FROM watch_history WHERE user_id = $1',
      [channel.owner_id]
    )
    watchedIdsByType.movie = new Set(watched.rows.map((r) => r.movie_id))
  }

  if (mediaTypes.includes('series')) {
    const watched = await query<{ series_id: string }>(
      `SELECT DISTINCT e.series_id
       FROM watch_history wh
       JOIN episodes e ON e.id = wh.episode_id
       WHERE wh.user_id = $1 AND wh.media_type = 'episode' AND e.series_id IS NOT NULL`,
      [channel.owner_id]
    )
    watchedIdsByType.series = new Set(watched.rows.map((r) => r.series_id))
  }

  const excludeIds = new Set(existing.map((r) => r.itemId))

  const extras = await resolveToLibraryItems(
    candidates,
    mediaTypes,
    excludeIds,
    watchedIdsByType,
    channel.max_parental_rating,
    limit
  )

  logger.info(
    {
      channelId,
      mediaTypes,
      candidates: candidates.length,
      added: extras.length,
      addedSeries: extras.filter((e) => e.mediaType === 'series').length,
    },
    'Channel web expansion resolved'
  )

  return extras
}
