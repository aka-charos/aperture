/**
 * Episode-level semantic search.
 *
 * `episode_embeddings_*` is by far the largest embedding table on a real
 * library — one row per episode against one per show — and until this tool
 * existed nothing read it. Two functions could (`getEpisodeEmbedding`,
 * `getSeriesEpisodeEmbeddings`, the second commented "for computing series
 * taste from episodes") but neither had a caller, so every episode that landed
 * in the library bought an embedding call for an index with no consumer.
 *
 * What it buys now is the class of question the series vector cannot answer.
 * `buildSeriesCanonicalText` describes the *show*: title, genres, the overview,
 * crew, and the literal string "5 seasons, 62 episodes". No episode plot is in
 * there. So "the one where they get stuck in the desert" is unanswerable from
 * the series index however good it is — it is a question about the content of
 * one episode, and the only place that content is vectorized is here.
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getActiveEmbeddingTableName, getEpisodeEmbeddingsEnabled } from '@aperture/core'
import { query, transaction } from '../../../lib/db.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import { anyTitleMatchesSql } from '../helpers/titleMatch.js'
import { briefResult, FORMAT_PARAM_DESCRIPTION, nullSafe } from './utils.js'
import type { ContentItem } from '../schemas/index.js'
import type { ToolContext } from '../types.js'
import type { WatchStatus } from './search.js'

/**
 * See the note on HNSW_EF_SEARCH_FILTERED in search.ts — same reason, same
 * value. A series or watch-status filter post-filters the ANN scan, and an
 * HNSW scan never yields more rows than `ef_search` (default 40). Scoping to
 * one show is the worst case in this file: a single series is a fraction of a
 * percent of the episode index, so at the default the filter would return
 * nothing and look broken.
 */
const HNSW_EF_SEARCH_FILTERED = 500

/** Row shape returned by the episode ANN query. */
export interface EpisodeSearchRow {
  id: string
  title: string
  season_number: number
  episode_number: number
  overview: string | null
  year: number | null
  community_rating: number | string | null
  poster_url: string | null
  provider_item_id: string | null
  series_id: string
  series_title: string
  series_poster_url: string | null
}

/**
 * pg returns NUMERIC as a *string*, so a stored 0 arrives as '0.00' and passes
 * a truthy test while a real 0 as a number fails one. Same trap the insights
 * panel hit; coerce once here rather than leaving it to the card.
 */
function toRating(value: number | string | null): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** "S2E9", zero-padded so a season list sorts the way it reads. */
export function episodeMarker(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

/**
 * An episode rendered as a ContentItem.
 *
 * Three choices worth keeping straight. (1) `id` is the EPISODE id, because
 * ContentCarousel keys on it and two episodes of one show would otherwise
 * collide — navigation is carried separately by `episode.seriesId`, which the
 * card prefers when present. (2) `name` is the episode title, since the episode
 * is the answer; the show goes in the subtitle. (3) `image` falls back to the
 * series poster: many libraries have no per-episode still, and a card with no
 * art next to cards with art reads as a broken result rather than a thin one.
 */
export function formatEpisodeItem(
  row: EpisodeSearchRow,
  playLink: string | null
): ContentItem {
  const marker = episodeMarker(row.season_number, row.episode_number)
  // Year first: ContentCard's splitMeta only lifts a year into the title parens
  // when it is the leading segment, so this is what makes an episode card read
  // like every other card instead of dropping the year into the meta line.
  const subtitle = [row.year, row.series_title, marker].filter(Boolean).join(' · ')

  return {
    id: row.id,
    type: 'series',
    name: row.title,
    subtitle,
    image: row.poster_url ?? row.series_poster_url ?? null,
    overview: row.overview ?? null,
    rating: toRating(row.community_rating),
    episode: {
      seriesId: row.series_id,
      seriesTitle: row.series_title,
      season: row.season_number,
      number: row.episode_number,
    },
    actions: [
      {
        id: 'details',
        label: 'Details',
        href: `/series/${row.series_id}`,
        variant: 'secondary',
      },
      ...(playLink
        ? [{ id: 'play', label: 'Play', href: playLink, variant: 'primary' as const }]
        : []),
    ],
  }
}

/**
 * Membership in the user's episode watch history.
 *
 * Deliberately the same shape as `watchStatusCondition` in search.ts — plain
 * membership, not the progress-threshold predicate — so the two tools agree
 * about what "watched" means. `watch_history` stores one row per episode with a
 * check constraint making exactly one of movie_id/episode_id non-null, so this
 * needs no media_type guard.
 */
export function episodeWatchCondition(
  status: Exclude<WatchStatus, 'all'>,
  paramIdx: number
): string {
  return `ep.id ${status === 'watched' ? 'IN' : 'NOT IN'} (
    SELECT episode_id FROM watch_history
    WHERE user_id = $${paramIdx} AND episode_id IS NOT NULL
  )`
}

/**
 * Stamp `watched` on episode results.
 *
 * The generic `annotateWatchedItems` cannot do this: it partitions by
 * `item.type` and looks the ids up against movies and series, and an episode id
 * matches neither — it would come back all-false, which the schema says means
 * something different from "not looked up". Absent on failure, for the same
 * reason.
 */
async function annotateWatchedEpisodes(userId: string, items: ContentItem[]): Promise<void> {
  if (items.length === 0) return
  try {
    const result = await query<{ episode_id: string }>(
      `SELECT DISTINCT episode_id FROM watch_history
       WHERE user_id = $1 AND episode_id = ANY($2::uuid[])`,
      [userId, items.map((i) => i.id)]
    )
    const watched = new Set(result.rows.map((r) => r.episode_id))
    for (const item of items) item.watched = watched.has(item.id)
  } catch {
    // Leave the field absent — see the schema note on absent vs false.
  }
}

/**
 * Returns nothing when episode embeddings are switched off.
 *
 * The condition lives here rather than at the call site for two reasons. The
 * table would be empty, and a tool that can only answer "no episodes matched"
 * is worse than an absent one — the model would use it and report a confident
 * false negative. And returning a plain `ToolSet` keeps the merged tool object
 * free of optional properties: a conditional spread in the handler made every
 * tool `T | undefined` to the type checker, which broke the step logging.
 */
export async function createEpisodeTools(ctx: ToolContext): Promise<ToolSet> {
  if (!(await getEpisodeEmbeddingsEnabled())) return {}

  return {
    searchEpisodes: tool({
      description:
        'Find INDIVIDUAL EPISODES of TV series by what happens in them, using AI embeddings over ' +
        'each episode\'s own synopsis. This is the ONLY tool that can answer a question about ' +
        'episode content — "the episode where they get stuck in the desert", "the Black Mirror one ' +
        'about the dating app", "which episode introduces the new villain". semanticSearch and ' +
        'searchContent both work at SHOW level and know nothing about what happens inside an ' +
        'episode, so they cannot answer these and will return whole series instead. Set `series` ' +
        'when the user names a show, which both scopes and sharpens the search.',
      inputSchema: nullSafe(
        z.object({
          concept: z
            .string()
            .describe(
              'What happens in the episode, in the user\'s own terms. Describe the events, ' +
                'setting or premise — "trapped in the desert with a broken car", "a dinner party ' +
                'that goes wrong". Do not pass an episode title unless the user gave one.'
            ),
          series: z
            .string()
            .optional()
            .describe(
              'Restrict to one show by name. Use whenever the user names a series — an episode ' +
                'index spans every show in the library, so an unscoped search can return a ' +
                'plausible episode of the wrong programme.'
            ),
          watchStatus: z
            .enum(['all', 'watched', 'unwatched'])
            .optional()
            .default('all')
            .describe(
              'Restrict to episodes the user HAS watched ("watched"), has NOT watched ' +
                '("unwatched"), or both ("all", the default). "watched" is the right choice for ' +
                '"that episode I saw where…", which is the most common form of this question.'
            ),
          limit: z
            .number()
            .optional()
            .default(10)
            .describe('Number of episodes to return (default 10, max 30)'),
          format: z
            .enum(['cards', 'brief'])
            .optional()
            .default('cards')
            .describe(FORMAT_PARAM_DESCRIPTION),
        })
      ),
      execute: async ({ concept, series, watchStatus = 'all', limit = 10, format = 'cards' }) => {
        try {
          const safeLimit = Math.min(limit ?? 10, 30)
          const tableName = await getActiveEmbeddingTableName('episode_embeddings')

          const embedding = await ctx.embedding.embedOne(concept)
          const embeddingStr = `[${embedding.join(',')}]`

          // $1 embedding, $2 model, $3 limit are fixed; optional filters take
          // the next indices in a fixed order.
          const clauses: string[] = []
          const extra: unknown[] = []
          let idx = 4

          const seriesName = series?.trim()
          if (seriesName) {
            clauses.push(`AND ${anyTitleMatchesSql(`$${idx}`, 's')}`)
            extra.push(`%${seriesName}%`)
            idx++
          }
          if (watchStatus !== 'all') {
            clauses.push(`AND ${episodeWatchCondition(watchStatus, idx)}`)
            extra.push(ctx.userId)
            idx++
          }

          const sql = `
            SELECT ep.id, ep.title, ep.season_number, ep.episode_number, ep.overview,
                   ep.year, ep.community_rating, ep.poster_url, ep.provider_item_id,
                   s.id AS series_id, s.title AS series_title,
                   s.poster_url AS series_poster_url
            FROM ${tableName} ee
            JOIN episodes ep ON ep.id = ee.episode_id
            JOIN series s ON s.id = ep.series_id
            WHERE ee.model = $2 ${clauses.join(' ')}
            ORDER BY ee.embedding <=> $1::halfvec
            LIMIT $3`
          const params = [embeddingStr, ctx.embedding.setId, safeLimit, ...extra]

          const hasPostFilter = clauses.length > 0
          const result = hasPostFilter
            ? await transaction(async (client) => {
                await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH_FILTERED}`)
                const res = await client.query(sql, params)
                return { rows: res.rows as EpisodeSearchRow[] }
              })
            : await query<EpisodeSearchRow>(sql, params)

          const items = result.rows.map((row) =>
            formatEpisodeItem(row, buildPlayLink(ctx.mediaServer, row.provider_item_id, 'series'))
          )
          await annotateWatchedEpisodes(ctx.userId, items)

          if (format === 'brief') {
            return briefResult(
              `episodes-${Date.now()}`,
              items.map((i) => ({
                name: `${i.episode?.seriesTitle ?? ''} ${episodeMarker(
                  i.episode?.season ?? 0,
                  i.episode?.number ?? 0
                )} — ${i.name}`.trim(),
                note: i.watched === true ? 'watched' : null,
              }))
            )
          }

          if (items.length === 0) {
            return {
              id: `episodes-empty-${Date.now()}`,
              items: [],
              descriptionKey: 'carouselEpisodesEmpty' as const,
              descriptionParams: { concept },
            }
          }

          return {
            id: `episodes-${Date.now()}`,
            titleKey: 'carouselEpisodesTitle' as const,
            titleParams: { concept },
            descriptionKey: 'carouselEpisodesDesc' as const,
            descriptionParams: { count: items.length },
            items,
          }
        } catch (err) {
          console.error('[searchEpisodes] Error:', err)
          return {
            id: `episodes-error-${Date.now()}`,
            items: [],
            descriptionKey: 'carouselEpisodesError' as const,
            descriptionParams: {
              message: err instanceof Error ? err.message : 'Unknown error',
            },
          }
        }
      },
    }),
  }
}
