/**
 * Search the pool of candidates the recommender has already scored for a user.
 *
 * Two consumers, one query. `searchMyRecommendations` calls it as a tool, and
 * the discovery pipeline calls it alongside the web search to build its taste
 * section — and those two must not drift, because a difference between them
 * shows up as the same request answering differently depending on which engine
 * the intent router picked.
 *
 * Extracted rather than copied for that reason: the ANN pool size, the
 * `ef_search` transaction and the NUMERIC handling are each a silent-failure
 * trap, and a second copy is a second place to get them wrong.
 */
import { getActiveEmbeddingTableName, createChildLogger } from '@aperture/core'
import { transaction } from '../../../lib/db.js'
import { readTwinSharedIds, resolveTwinSharedTitles } from '../../../lib/twinShared.js'
import { blendQueryAndTaste } from './tasteBlend.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext, MovieResult, SeriesResult } from '../types.js'

const logger = createChildLogger('scored-pool')

/**
 * How many nearest neighbours to pull before blending in taste.
 *
 * Big enough that the join against the scored pool still leaves plenty after
 * watched titles drop out, small enough that the re-rank stays trivial. The ANN
 * index does the expensive part; this is just how much of its output gets a
 * second opinion.
 */
export const ANN_POOL_SIZE = 400

/**
 * pgvector's HNSW search-list size for the query below.
 *
 * Must be >= ANN_POOL_SIZE. The default is 40, which is smaller than the pool
 * this asks for, and an HNSW scan will never return more rows than ef_search —
 * so leaving it alone means either a short result or a planner that gives up on
 * the index and sequentially scans every embedding. Set per statement with SET
 * LOCAL rather than on the pool, so it cannot leak into the other vector
 * queries that are tuned for the default.
 */
const HNSW_EF_SEARCH = 500

/** Narrow a plural media type to the singular one the queries use. */
export const asMedia = (type: 'movies' | 'series' | 'both'): 'movie' | 'series' =>
  type === 'series' ? 'series' : 'movie'

/**
 * Which reserved slot, if any, put a pick in the list.
 *
 * Derived from score_breakdown rather than passed through it, because that
 * object also holds `twinMatch.donorId` and the model must never receive an
 * identity it could name — the copy rule everywhere else in the app is
 * "someone here whose taste closely overlaps yours". An enum carries the whole
 * fact the model needs and nothing it doesn't.
 *
 * Defaults to 'ranked' for anything unrecognised, which is both the honest
 * reading of a breakdown with no slot marker and the safe one: runs written
 * before reserved slots existed simply look like ordinary picks.
 */
export function pickSource(
  scoreBreakdown: unknown
): 'ranked' | 'twin' | 'interest' | 'acclaimed' {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return 'ranked'

  const breakdown = scoreBreakdown as Record<string, unknown>
  if (typeof breakdown.twinMatch === 'object' && breakdown.twinMatch !== null) return 'twin'
  if (typeof breakdown.interestMatch === 'object' && breakdown.interestMatch !== null) {
    return 'interest'
  }
  if (typeof breakdown.acclaimedMatch === 'object' && breakdown.acclaimedMatch !== null) {
    return 'acclaimed'
  }
  return 'ranked'
}

/** Format a library row as a Tool UI card. */
export function formatContentItem(
  item: MovieResult | SeriesResult,
  type: 'movie' | 'series',
  playLink: string | null,
  rank?: number,
  source?: 'ranked' | 'twin' | 'interest' | 'acclaimed',
  sharedTitles?: string[],
  /**
   * The run's stored `ai_explanation`, when the caller selected it.
   *
   * NULL is the normal state for a run made while AI explanations were off —
   * that is never backfilled, so the card simply has no note and the list
   * renders without one.
   */
  reason?: string | null
): ContentItem {
  const genres = item.genres?.slice(0, 2).join(', ') || ''
  const subtitle = [item.year, genres].filter(Boolean).join(' · ')

  return {
    id: item.id,
    type,
    name: item.title,
    subtitle,
    image: item.poster_url,
    // For a series this column holds the creators — the card labels it accordingly.
    director: (item.directors ?? []).slice(0, 2).join(', ') || null,
    overview: item.overview ?? null,
    rating: item.community_rating,
    rank,
    ...(reason ? { reason } : {}),
    ...(source ? { source } : {}),
    ...(sharedTitles?.length ? { sharedTitles } : {}),
    actions: [
      {
        id: 'details',
        label: 'Details',
        href: `/${type === 'movie' ? 'movies' : 'series'}/${item.id}`,
        variant: 'secondary',
      },
      ...(playLink
        ? [{ id: 'play', label: 'Play', href: playLink, variant: 'primary' as const }]
        : []),
    ],
  }
}

export interface ScoredPoolSearchOptions {
  /** The theme/mood phrase to search for. Embedded as-is. */
  concept: string
  type?: 'movies' | 'series' | 'both'
  limit?: number
  /**
   * The request's share of the ranking. Omitted = `QUERY_WEIGHT`, which leans
   * on the request; the discovery taste section passes the mirror of it.
   */
  queryWeight?: number
  /** Label for the log line, so two callers are distinguishable in a log. */
  caller?: string
}

/**
 * Rank the user's already-scored pool against a phrase.
 *
 * Two stages on purpose. The ANN index answers "nearest to the request"
 * cheaply; joining that to the newest completed run's stored candidates is what
 * makes the result personal — and, because the pool is by construction what the
 * user has NOT seen, it applies the pipeline's watched exclusion for free.
 * Blending in SQL would put the one piece of real arithmetic somewhere no test
 * can reach.
 *
 * Returns cards with no `reason`: whether to pay for enrichment, and against
 * which text, belongs to the caller. The tool enriches against its own concept;
 * discovery folds these into the single pass it already runs for every section.
 */
export async function searchScoredPool(
  ctx: ToolContext,
  { concept, type = 'both', limit = 12, queryWeight, caller = 'tool' }: ScoredPoolSearchOptions
): Promise<ContentItem[]> {
  const embedding = await ctx.embedding.embedOne(concept)
  const embeddingStr = `[${embedding.join(',')}]`

  const items: ContentItem[] = []

  for (const media of type === 'both' ? (['movie', 'series'] as const) : [asMedia(type)]) {
    const isMovie = media === 'movie'
    const table = await getActiveEmbeddingTableName(
      isMovie ? 'embeddings' : 'series_embeddings'
    )
    const idColumn = isMovie ? 'movie_id' : 'series_id'
    const contentTable = isMovie ? 'movies' : 'series'

    // Runs in a transaction solely to carry `SET LOCAL hnsw.ef_search` — see
    // the constant above for why a bare LIMIT cannot be trusted here.
    const rows = await transaction(async (client) => {
      await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`)
      return client.query<{
        id: string
        title: string
        year: number | null
        genres: string[]
        overview: string | null
        community_rating: number | null
        poster_url: string | null
        provider_item_id: string | null
        directors: string[] | null
        query_score: number
        final_score: string | number | null
        score_breakdown: Record<string, unknown> | null
      }>(
        `WITH latest AS (
               SELECT id FROM recommendation_runs
                WHERE user_id = $1 AND status = 'completed' AND media_type = $2
                ORDER BY created_at DESC
                LIMIT 1
             ),
             near AS (
               SELECT e.${idColumn} AS item_id,
                      1 - (e.embedding <=> $3::halfvec) AS query_score
                 FROM ${table} e
                WHERE e.model = $4
                ORDER BY e.embedding <=> $3::halfvec
                LIMIT $5
             )
             SELECT c.id, c.title, c.year, c.genres, c.overview, c.community_rating,
                    c.poster_url, c.provider_item_id, c.directors,
                    near.query_score, rc.final_score, rc.score_breakdown
               FROM near
               JOIN recommendation_candidates rc
                 ON rc.${idColumn} = near.item_id
                AND rc.run_id = (SELECT id FROM latest)
               JOIN ${contentTable} c ON c.id = near.item_id`,
        [ctx.userId, media, embeddingStr, ctx.embedding.setId, ANN_POOL_SIZE]
      )
    })

    // NUMERIC arrives from pg as a string; Number() it before any maths, or the
    // blend silently compares strings.
    const ranked = blendQueryAndTaste(
      rows.rows.map((r) => ({
        row: r,
        queryScore: Number(r.query_score),
        tasteScore: r.final_score != null ? Number(r.final_score) : 0,
      })),
      queryWeight
    ).slice(0, limit)

    // The one record of what was actually searched for. The concept is written
    // by the MODEL, not by the user — it paraphrases the request into a phrase
    // before anything is embedded — so when a result is off, this is the
    // difference between a bad paraphrase and a thin library, which are
    // indistinguishable from the cards alone. Per media type, because the two
    // have separate runs: 'both' with 200 movies matched and 0 series is a
    // completed movie run beside a missing series one, and one summed line
    // would hide it.
    logger.info(
      {
        caller,
        concept,
        media,
        queryWeight: queryWeight ?? 'default',
        annPool: ANN_POOL_SIZE,
        matched: rows.rows.length,
        returned: ranked.length,
      },
      'Personalized library search'
    )

    const sharedTitles = await resolveTwinSharedTitles(
      ranked.map((r) => r.row.score_breakdown),
      isMovie ? 'movies' : 'series'
    )

    for (const { row: r } of ranked) {
      const playLink = buildPlayLink(ctx.mediaServer, r.provider_item_id, media)
      items.push(
        // Deliberately no rank. `rank` renders as a RankBadge on the poster,
        // which reads as "position in this list" — and the only rank these rows
        // carry is `recommendation_candidates.rank`, the position among
        // *everything the run scored*. Passing it stamped "2012" and "449" on
        // the first two cards. The list is already in blended order, so the
        // badge has nothing true to say here; semanticSearch omits it too.
        formatContentItem(
          r as unknown as MovieResult,
          media,
          playLink,
          undefined,
          pickSource(r.score_breakdown),
          readTwinSharedIds(r.score_breakdown)
            .map((id) => sharedTitles.get(id))
            .filter((title): title is string => Boolean(title))
        )
      )
    }
  }

  return items
}
