/**
 * Reading the titles that earned a taste-twin relationship.
 *
 * Lives in lib/ rather than beside one route because both insights handlers
 * (`routes/recommendations/handlers/`) need it, and it is the kind of thing a
 * third surface will want the moment twin picks appear anywhere else.
 *
 * The ids come from `score_breakdown.twinMatch.sharedIds`, written by core's
 * recommender/storage.ts. They are the *rarest* titles both viewers watched,
 * which is the quantity the affinity score is literally made of — so they are
 * the honest answer to "why is this in my list", as opposed to
 * `recommendation_evidence`, which is a content-similarity lookup run after the
 * pick was made and had no part in it.
 */

import { query } from './db.js'

export interface TwinSharedItem {
  id: string
  title: string
  year: number | null
  poster_url: string | null
}

/**
 * Pull the stored shared-title ids off a candidate's score_breakdown.
 *
 * Defensive at every step: score_breakdown is JSONB with no schema, holds
 * whatever the pipeline version that wrote the run put there, and runs written
 * before this shipped have a twinMatch with no sharedIds at all. Anything
 * unexpected reads as "no titles", which every caller renders as the plain
 * anonymous line they had before.
 */
export function readTwinSharedIds(scoreBreakdown: unknown): string[] {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return []

  const twinMatch = (scoreBreakdown as Record<string, unknown>).twinMatch
  if (typeof twinMatch !== 'object' || twinMatch === null) return []

  const ids = (twinMatch as Record<string, unknown>).sharedIds
  if (!Array.isArray(ids)) return []

  return ids.filter((id): id is string => typeof id === 'string')
}

/**
 * The rarest titles both the reader and their twin have watched, for one pick.
 *
 * `table` is a literal union, never request data, so interpolating it is not an
 * injection surface — every caller passes its own constant.
 */
export async function resolveTwinShared(
  scoreBreakdown: unknown,
  table: 'movies' | 'series'
): Promise<TwinSharedItem[]> {
  const ids = readTwinSharedIds(scoreBreakdown)
  if (ids.length === 0) return []

  // array_position preserves the stored order, which is rarest-first and so is
  // the order in which these titles best explain the match. ANY() on its own
  // returns rows in whatever order the planner finds convenient.
  const result = await query<TwinSharedItem>(
    `SELECT id, title, year, poster_url
       FROM ${table}
      WHERE id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], id)`,
    [ids]
  )

  return result.rows
}
