/**
 * Reading the titles that earned a taste-twin relationship.
 *
 * Lives in lib/ rather than beside one route because three surfaces need it:
 * both insights handlers (`routes/recommendations/handlers/`) and the
 * assistant's recommendation tool, which are otherwise unrelated.
 *
 * The ids come from `score_breakdown.twinMatch.sharedIds`, written by core's
 * recommender/storage.ts. They are the *rarest* titles both viewers watched,
 * which is the quantity the affinity score is literally made of — so they are
 * the honest answer to "why is this in my list", as opposed to
 * `recommendation_evidence`, which is a content-similarity lookup run after the
 * pick was made and had no part in it.
 */

import { getVisibleConnection } from '@aperture/core'
import { query } from './db.js'
import { readTwinDonorId } from './scoreBreakdown.js'

/** The taste twin, as the reader is allowed to see them. */
export interface TwinDonor {
  name: string
  avatarUrl: string
}

/**
 * The twin behind a pick, but only when they are a visible connection of
 * `readerId` (social/rules.ts rule 1); null otherwise, which every caller
 * sends as no key at all. Copy names nobody else (F-049): a twin can be anyone
 * with watch history, including someone who has recommendations switched off
 * and never agreed to be shown to anyone. A connection is the one case where
 * naming discloses nothing new — the two already see each other's history.
 *
 * Never handed to the assistant: it holds a name a model could repeat, and the
 * assistant gets no social data at all.
 */
export async function resolveTwinDonor(scoreBreakdown: unknown, readerId: string): Promise<TwinDonor | null> {
  const donorId = readTwinDonorId(scoreBreakdown)
  if (!donorId) return null
  const connection = await getVisibleConnection(readerId, donorId)
  return connection ? { name: connection.name, avatarUrl: connection.avatarUrl } : null
}

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

/**
 * Titles for many picks at once, as an id -> title map.
 *
 * The per-pick resolver above is right for the insights panel, which renders
 * exactly one candidate. The assistant returns up to fifty in a single tool
 * call, and calling that once per item would put fifty round trips inside one
 * chat turn — so the ids are gathered across every pick and looked up together.
 * Callers keep their own per-pick id lists and index into this.
 */
export async function resolveTwinSharedTitles(
  scoreBreakdowns: unknown[],
  table: 'movies' | 'series'
): Promise<Map<string, string>> {
  const ids = [...new Set(scoreBreakdowns.flatMap(readTwinSharedIds))]
  if (ids.length === 0) return new Map()

  const result = await query<{ id: string; title: string }>(
    `SELECT id, title FROM ${table} WHERE id = ANY($1::uuid[])`,
    [ids]
  )

  return new Map(result.rows.map((row) => [row.id, row.title]))
}
