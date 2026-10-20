/**
 * The stored side of explanation reuse (shared/explanationReuse.ts decides).
 *
 * Kept in its own table, recommendation_explanation_cache (0211), because
 * "Regenerate" and "Full reset" delete the viewer's runs before building the
 * new one: a cache kept on the runs would be gone exactly when it is needed.
 *
 * Every function here swallows its own failure. Reuse saves money; it must
 * never cost a run its explanations -- a failed read writes everything, a
 * failed write only means the next run pays again.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getFunctionConfig, getReasoningProviderOptions } from '../lib/ai-provider.js'
import type { StoredExplanation } from './shared/explanationReuse.js'

const logger = createChildLogger('explanation-cache')

export type ExplanationCacheMediaType = 'movie' | 'series'

/**
 * Whether a generator may hand back a stored explanation. Required at every
 * call, never defaulted: the pipelines reuse, while the refresh job and the
 * per-pick Rewrite button exist to write the text again and must not be handed
 * the text they were asked to replace.
 */
export interface ExplanationReuseOptions {
  reuse: boolean
}

/**
 * Who writes the explanations right now, as one string for the fingerprint:
 * provider, model and the reasoning options actually sent. A model change is
 * an operator asking for a different writer.
 */
export async function explanationWriterKey(): Promise<string> {
  const config = await getFunctionConfig('textGeneration')
  const reasoning = await getReasoningProviderOptions('textGeneration').catch(() => undefined)
  return JSON.stringify({
    provider: config?.provider ?? null,
    model: config?.model ?? null,
    reasoning: reasoning ?? null,
  })
}

/** The stored explanations for these picks, keyed by item id. */
export async function loadStoredExplanations(
  userId: string,
  mediaType: ExplanationCacheMediaType,
  itemIds: string[]
): Promise<Map<string, StoredExplanation>> {
  if (itemIds.length === 0) return new Map()
  try {
    const result = await query<{ item_id: string; fingerprint: string; explanation: string }>(
      `SELECT item_id, fingerprint, explanation
         FROM recommendation_explanation_cache
        WHERE user_id = $1 AND media_type = $2 AND item_id = ANY($3::uuid[])`,
      [userId, mediaType, itemIds]
    )
    return new Map(
      result.rows.map((row) => [
        row.item_id,
        { fingerprint: row.fingerprint, explanation: row.explanation },
      ])
    )
  } catch (err) {
    logger.warn({ err, userId, mediaType }, 'Could not read stored explanations; writing all')
    return new Map()
  }
}

/** One explanation to remember, with the fingerprint it was written under. */
export interface ExplanationToRemember {
  itemId: string
  fingerprint: string
  explanation: string
}

/**
 * Remember the model-written explanations of a run, then trim the viewer's
 * rows for this media type to the run's picks, so the table stays the size of
 * their lists and a title that left the library leaves with the next run.
 *
 * Trimmed by the run's SELECTED picks, not by the entries passed in: the
 * Rewrite button stores one pick, and trimming to that one would forget the
 * rest of the list.
 */
export async function rememberExplanations(
  runId: string,
  mediaType: ExplanationCacheMediaType,
  entries: ExplanationToRemember[]
): Promise<void> {
  const itemColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'
  try {
    const run = await query<{ user_id: string }>(
      `SELECT user_id FROM recommendation_runs WHERE id = $1`,
      [runId]
    )
    const userId = run.rows[0]?.user_id
    if (!userId) return

    if (entries.length > 0) {
      await query(
        `INSERT INTO recommendation_explanation_cache
           (user_id, media_type, item_id, fingerprint, explanation, written_at)
         SELECT $1, $2, t.item_id, t.fingerprint, t.explanation, NOW()
           FROM unnest($3::uuid[], $4::text[], $5::text[]) AS t(item_id, fingerprint, explanation)
         ON CONFLICT (user_id, media_type, item_id) DO UPDATE
           SET fingerprint = EXCLUDED.fingerprint,
               explanation = EXCLUDED.explanation,
               written_at = EXCLUDED.written_at
           WHERE recommendation_explanation_cache.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
              OR recommendation_explanation_cache.explanation IS DISTINCT FROM EXCLUDED.explanation`,
        [
          userId,
          mediaType,
          entries.map((e) => e.itemId),
          entries.map((e) => e.fingerprint),
          entries.map((e) => e.explanation),
        ]
      )
    }

    await query(
      `DELETE FROM recommendation_explanation_cache c
        WHERE c.user_id = $1 AND c.media_type = $2
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_candidates rc
             WHERE rc.run_id = $3 AND rc.is_selected = true AND rc.${itemColumn} = c.item_id
          )`,
      [userId, mediaType, runId]
    )
  } catch (err) {
    logger.warn({ err, runId, mediaType }, 'Could not store explanations for reuse')
  }
}
