/**
 * Reading the titles that earned a taste-twin relationship.
 *
 * Lives in lib/ rather than beside one route because three surfaces need it:
 * both insights handlers (`routes/recommendations/handlers/`) and the
 * assistant's recommendation tool, which are otherwise unrelated.
 *
 * The ids come from `score_breakdown.twinMatch.sharedIds`, written by core's
 * recommender/storage.ts: titles both viewers PLAYED, nearest to the pick first
 * (core recommender/twinNearShared.ts). They are not why the pick is here — the
 * twin is — but they are the honest version of "you both watched these, which
 * are like this one".
 *
 * Runs from before that stored the RAREST shared titles instead, with no
 * `sharedOrder`. Those are an arbitrary slice of a tie and unrelated to the
 * pick, and reading as if they explained it is the fault this replaced — so
 * they are read as no titles at all, never shown. The rule itself is pure and
 * pinned in lib/scoreBreakdown.ts (`readTwinSharedTitles`).
 */

import { getVisibleConnection, readOwnStanding, twinStandingBand } from '@aperture/core'
import { query } from './db.js'
import { readTwinDonorId, readTwinSharedIds, readTwinSharedTitles } from './scoreBreakdown.js'

export { readTwinSharedIds }

/**
 * Whether a twin pick came close to the list on its OWN score (core
 * twinStandingBand: inside the list's range, or just outside it), as a field
 * to spread into the insights response. Decided here so the banner can stop
 * saying the twin put it there "rather than the scores below" when the scores
 * below nearly did it alone. No field for any other pick, or for a run that
 * stored no standing: the banner then keeps its old copy.
 */
export function twinCameClose(scoreBreakdown: unknown): { twinCameClose?: boolean } {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return {}
  const twinMatch = (scoreBreakdown as Record<string, unknown>).twinMatch
  if (typeof twinMatch !== 'object' || twinMatch === null) return {}
  const band = twinStandingBand(readOwnStanding((twinMatch as Record<string, unknown>).ownStanding))
  return band == null ? {} : { twinCameClose: band === 'inside' || band === 'near' }
}

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
  /**
   * Raw cosine to the pick, stored by the run beside the id — the same measure
   * and the same embedding set as that run's evidence rows, so the panel can
   * merge the two into one row ordered by closeness. Null when not stored.
   */
  similarity: number | null
}

/**
 * The titles both the reader and their twin watched, nearest to the pick
 * first, each with the similarity the run stored.
 *
 * `table` is a literal union, never request data, so interpolating it is not an
 * injection surface — every caller passes its own constant.
 */
export async function resolveTwinShared(
  scoreBreakdown: unknown,
  table: 'movies' | 'series'
): Promise<TwinSharedItem[]> {
  const stored = readTwinSharedTitles(scoreBreakdown)
  if (stored.length === 0) return []
  const ids = stored.map((title) => title.id)
  const similarityById = new Map(stored.map((title) => [title.id, title.similarity]))

  // array_position preserves the stored order, nearest first. ANY() on its own
  // returns rows in whatever order the planner finds convenient.
  const result = await query<Omit<TwinSharedItem, 'similarity'>>(
    `SELECT id, title, year, poster_url
       FROM ${table}
      WHERE id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], id)`,
    [ids]
  )

  return result.rows.map((row) => ({ ...row, similarity: similarityById.get(row.id) ?? null }))
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
