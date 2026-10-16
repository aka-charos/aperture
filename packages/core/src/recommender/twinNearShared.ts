/**
 * The titles shown beside a taste-twin pick: what the two viewers both
 * watched, nearest to the pick first.
 *
 * WHY NOT THE RAREST. The pair's affinity is built from rarity-weighted overlap
 * (twinAffinity.ts), and the panel used to show the six rarest titles they
 * shared as the reason for the pick. Two things made that read as nonsense.
 * Rarity is what proves two people match, and it is also what makes the titles
 * eclectic: Very Bad Things beside Kobane. And in a household of a dozen
 * accounts every title only those two watched has the same idf, ln(N/2), so the
 * six shown were an arbitrary slice of a tie, chosen by row order. Nothing
 * compared them with the pick, yet they sat directly under it — and the
 * explanation prompt told the model to "build the explanation on" them, so it
 * wrote a thematic bridge between four arbitrary films and called it the
 * reason.
 *
 * So rarity stays what FINDS a twin, and this decides what is SHOWN: among the
 * titles both actually watched, the ones closest to the pick in the embedding.
 * That is a sentence the reader can check: "you both watched these, which are
 * like this one, and they watched this one too." What "watched" means is in
 * `sharedPlayedIds`: a played film, or a show either viewer got at least half
 * way through — never a bookmark (F-114) and never a sampled first episode.
 *
 * Raw embeddings, the same space storeEvidence uses, and the similarity is
 * STORED beside each id, exactly as recommendation_evidence stores its own.
 * The panel merges the two lists by that number, so both must come from the
 * run's embedding set; recomputing on read would compare this run's evidence
 * against whatever model is active today.
 *
 * The shared set is resolved FIRST and passed as an explicit id list, never
 * joined inside the nearest-neighbour query: beside `ORDER BY embedding <=> …`
 * a join predicate lets the planner pick the HNSW index and post-filter, and a
 * LIMIT 6 then comes back nearly empty (the ef_search invariant; F-062 made the
 * same choice for storeEvidence).
 */

import { query } from '../lib/db.js'
import { getActiveEmbeddingModelId, getActiveEmbeddingTableName } from '../lib/ai-provider.js'
import { createChildLogger } from '../lib/logger.js'
import { libraryEpisodeCountSql } from './series/libraryEpisodes.js'

const logger = createChildLogger('twin-near-shared')

/**
 * Stored beside `twinMatch.sharedIds` to say how the ids were chosen.
 *
 * Absent means a run from before this module, whose ids are the rarest shared
 * titles. Readers that put those titles in front of a viewer, or in a prompt,
 * use nothing for an absent order rather than the arbitrary six (the absent ≠
 * false invariant, applied in the direction that stops repeating the fault).
 * The API mirrors the literal in lib/scoreBreakdown.ts; both tests pin it.
 */
export const TWIN_SHARED_ORDER_NEAREST = 'nearest'

/**
 * How far into a show a viewer must have got for it to count as one they
 * watched: half the library's regular episodes. The same line as
 * completionMultiplier's "committed" band (> 0.5 there; reaching half counts
 * here), so a show sampled for one episode and dropped is never offered as
 * common ground, while one someone owns a season of and finished still is.
 */
export const SERIES_SHARED_MIN_COMPLETION = 0.5

/**
 * How many shared titles a twin pick stores. Six fits one poster row without
 * scrolling; the prompt takes the first TWIN_SHARED_TITLE_LIMIT of them.
 */
export const SHARED_TITLE_SAMPLE = 6

export type TwinMediaType = 'movie' | 'series'

export interface TwinPickRef {
  /** The recommended title. */
  itemId: string
  /** The twin whose watching made it eligible. */
  donorId: string
}

/** One shared title and its raw cosine to the pick. */
export interface NearSharedTitle {
  id: string
  similarity: number
}

/**
 * Picks grouped by donor, so one shared-set lookup serves every pick borrowed
 * from the same twin. Pure, so the grouping is pinned without a database.
 */
export function groupPicksByDonor(picks: TwinPickRef[]): Map<string, string[]> {
  const byDonor = new Map<string, string[]>()
  for (const pick of picks) {
    const items = byDonor.get(pick.donorId)
    if (items) {
      if (!items.includes(pick.itemId)) items.push(pick.itemId)
    } else {
      byDonor.set(pick.donorId, [pick.itemId])
    }
  }
  return byDonor
}

/**
 * Titles both viewers watched: a film both PLAYED, or a show each of them got
 * at least SERIES_SHARED_MIN_COMPLETION through (regular episodes only,
 * against what the library holds — libraryEpisodes.ts).
 */
async function sharedPlayedIds(
  mediaType: TwinMediaType,
  recipientId: string,
  donorId: string
): Promise<string[]> {
  if (mediaType === 'movie') {
    const result = await query<{ id: string }>(
      `SELECT DISTINCT r.movie_id AS id
         FROM watch_history r
         JOIN watch_history d ON d.movie_id = r.movie_id
                             AND d.user_id = $2
                             AND d.played = true
        WHERE r.user_id = $1
          AND r.media_type = 'movie'
          AND r.movie_id IS NOT NULL
          AND r.played = true`,
      [recipientId, donorId]
    )
    return result.rows.map((row) => row.id)
  }

  const result = await query<{ id: string }>(
    `WITH progress AS (
       SELECT wh.user_id, e.series_id, COUNT(DISTINCT e.id) AS watched
         FROM watch_history wh
         JOIN episodes e ON e.id = wh.episode_id
        WHERE wh.user_id = ANY($1::uuid[])
          AND wh.media_type = 'episode'
          AND wh.played = true
          AND e.season_number > 0
        GROUP BY wh.user_id, e.series_id
     )
     SELECT p.series_id AS id
       FROM progress p
      WHERE p.watched::numeric / ${libraryEpisodeCountSql('p.series_id')} >= $2
      GROUP BY p.series_id
     HAVING COUNT(DISTINCT p.user_id) = 2`,
    [[recipientId, donorId], SERIES_SHARED_MIN_COMPLETION]
  )
  return result.rows.map((row) => row.id)
}

async function embeddingTarget(mediaType: TwinMediaType): Promise<{
  modelId: string
  table: string
  column: 'movie_id' | 'series_id'
} | null> {
  const modelId = await getActiveEmbeddingModelId()
  if (!modelId) return null
  const table = await getActiveEmbeddingTableName(
    mediaType === 'movie' ? 'embeddings' : 'series_embeddings'
  )
  return { modelId, table, column: mediaType === 'movie' ? 'movie_id' : 'series_id' }
}

/**
 * For each twin pick, the titles both viewers watched, nearest to that pick
 * first, each with its raw cosine.
 *
 * A pick missing from the map has nothing to show (no embedding model, or no
 * shared title with a vector) and every caller renders the plain twin line.
 * Never throws: this is display data on a run that has already produced good
 * picks. A FAILED lookup returns null rather than an empty map, so the
 * explanation refresh can leave stored titles alone instead of overwriting
 * good ones with nothing.
 */
export async function findNearestSharedTitles(
  mediaType: TwinMediaType,
  recipientId: string,
  picks: TwinPickRef[],
  limit: number = SHARED_TITLE_SAMPLE
): Promise<Map<string, NearSharedTitle[]> | null> {
  const nearest = new Map<string, NearSharedTitle[]>()
  if (picks.length === 0) return nearest

  try {
    const target = await embeddingTarget(mediaType)
    if (!target) return nearest
    const { modelId, table, column } = target

    for (const [donorId, itemIds] of groupPicksByDonor(picks)) {
      const sharedIds = await sharedPlayedIds(mediaType, recipientId, donorId)
      if (sharedIds.length === 0) continue

      // `table` and `column` come from the embedding resolver and a literal
      // union, never from request data.
      const result = await query<{ item_id: string; shared_id: string; similarity: number }>(
        `SELECT sel.item_id, near.shared_id, near.similarity
           FROM unnest($1::uuid[]) AS sel(item_id)
           CROSS JOIN LATERAL (
             SELECT e2.${column} AS shared_id,
                    1 - (e2.embedding <=> e1.embedding) AS similarity
               FROM ${table} e1
               JOIN ${table} e2 ON e2.${column} = ANY($2::uuid[])
                               AND e2.model = $3
                               AND e2.${column} <> sel.item_id
              WHERE e1.${column} = sel.item_id AND e1.model = $3
              ORDER BY e2.embedding <=> e1.embedding
              LIMIT $4
           ) AS near
          ORDER BY sel.item_id, near.similarity DESC`,
        [itemIds, sharedIds, modelId, limit]
      )

      for (const row of result.rows) {
        const entry = { id: row.shared_id, similarity: Number(row.similarity) }
        const list = nearest.get(row.item_id)
        if (list) list.push(entry)
        else nearest.set(row.item_id, [entry])
      }
    }
  } catch (err) {
    logger.warn({ err, mediaType, recipientId }, 'Could not resolve nearest shared titles for twin picks')
    return null
  }

  return nearest
}

/**
 * The fields a twin pick stores for its shared titles. Empty when there is
 * nothing to show, so no order is claimed for ids that are not there.
 */
export function storedSharedFields(titles: NearSharedTitle[] | undefined): {
  sharedIds?: string[]
  sharedSimilarities?: number[]
  sharedOrder?: typeof TWIN_SHARED_ORDER_NEAREST
} {
  if (!titles || titles.length === 0) return {}
  return {
    sharedIds: titles.map((title) => title.id),
    sharedSimilarities: titles.map((title) => title.similarity),
    sharedOrder: TWIN_SHARED_ORDER_NEAREST,
  }
}
