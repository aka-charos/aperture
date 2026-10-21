/**
 * The stored side of explanation reuse (shared/explanationReuse.ts decides),
 * and the one copy of the reuse-then-write sequence both generators run.
 *
 * Kept in its own table, recommendation_explanation_cache (0211), because
 * "Regenerate" and "Full reset" delete the viewer's runs before building the
 * new one: a cache kept on the runs would be gone exactly when it is needed.
 *
 * Every read and write here swallows its own failure. Reuse saves money; it
 * must never cost a run its explanations -- a failed read writes everything, a
 * failed write only means the next run pays again.
 */

import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getFunctionConfig, getReasoningProviderOptions } from '../lib/ai-provider.js'
import {
  explanationTally,
  splitReusable,
  type PreparedPick,
  type StoredExplanation,
  type WrittenExplanation,
} from './shared/explanationReuse.js'

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
 * provider, endpoint, model and the reasoning options actually sent. The
 * endpoint is there because a self-hosted model id ("default", "qwen3") names
 * nothing on its own: moving the role to another server is a different writer
 * under the same name. Credentials are deliberately left out.
 */
export async function explanationWriterKey(): Promise<string> {
  const config = await getFunctionConfig('textGeneration')
  const reasoning = await getReasoningProviderOptions('textGeneration').catch(() => undefined)
  return JSON.stringify({
    provider: config?.provider ?? null,
    baseUrl: config?.baseUrl ?? null,
    model: config?.model ?? null,
    reasoning: reasoning ?? null,
  })
}

/** The stored explanations for these picks, keyed by item id. */
async function loadStoredExplanations(
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

/**
 * Explain a run's picks, reusing every stored explanation whose fingerprint
 * still matches and sending the rest to `writeBatch` in batches. One copy for
 * both generators, which differ only in how a block is rendered and a batch is
 * asked for.
 *
 * Results come back in list order. A cancel between batches leaves the
 * unwritten picks out, as it always did.
 */
export async function explainWithReuse<T>(args: {
  runId: string
  userId: string
  mediaType: ExplanationCacheMediaType
  prepared: PreparedPick<T>[]
  options: ExplanationReuseOptions
  batchSize: number
  writeBatch: (batch: PreparedPick<T>[]) => Promise<WrittenExplanation[]>
  shouldCancel?: () => boolean
}): Promise<WrittenExplanation[]> {
  const { runId, userId, mediaType, prepared, options, batchSize, writeBatch, shouldCancel } = args

  const stored = options.reuse
    ? await loadStoredExplanations(
        userId,
        mediaType,
        prepared.map((p) => p.id)
      )
    : new Map<string, StoredExplanation>()
  const { reused, toWrite } = splitReusable(
    prepared,
    (p) => p.id,
    (p) => p.fingerprint,
    stored
  )

  const byId = new Map<string, WrittenExplanation>()
  for (const { pick, explanation } of reused) {
    byId.set(pick.id, { id: pick.id, explanation, fingerprint: pick.fingerprint })
  }
  if (options.reuse) {
    logger.info(
      { runId, mediaType, reused: reused.length, toWrite: toWrite.length },
      '♻️ Reusing explanations whose inputs are unchanged'
    )
  }

  for (let i = 0; i < toWrite.length; i += batchSize) {
    if (shouldCancel?.()) {
      logger.info(
        { runId, mediaType, explained: byId.size, expected: prepared.length },
        '🛑 Explanation generation cancelled between batches'
      )
      break
    }
    for (const result of await writeBatch(toWrite.slice(i, i + batchSize))) {
      byId.set(result.id, result)
    }
  }

  const results = prepared
    .map((p) => byId.get(p.id))
    .filter((r): r is WrittenExplanation => r !== undefined)

  logger.info(
    { runId, mediaType, ...explanationTally(results, new Set(reused.map((r) => r.pick.id))) },
    '✅ AI explanations ready'
  )
  return results
}

/**
 * Remember the model-written explanations of a run, then trim the viewer's
 * rows for this media type to the run's picks, so the table stays the size of
 * their lists and a title that left the library leaves with the next run.
 *
 * Trimmed by the run's SELECTED picks, not by the entries passed in: the
 * Rewrite button stores one pick, and trimming to that one would forget the
 * rest of the list. And only when this run is the viewer's newest of its media
 * type: the refresh job stores against the newest COMPLETED run, and a
 * regeneration running at the same moment has a newer one whose rows a trim to
 * the older list would delete.
 */
export async function rememberExplanations(
  userId: string,
  runId: string,
  mediaType: ExplanationCacheMediaType,
  entries: WrittenExplanation[]
): Promise<void> {
  const remembered = entries.filter((e) => e.fingerprint)
  const itemColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'
  try {
    if (remembered.length > 0) {
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
          remembered.map((e) => e.id),
          remembered.map((e) => e.fingerprint),
          remembered.map((e) => e.explanation),
        ]
      )
    }

    await query(
      `DELETE FROM recommendation_explanation_cache c
        WHERE c.user_id = $1 AND c.media_type = $2
          AND $3::uuid = (
            SELECT r.id FROM recommendation_runs r
             WHERE r.user_id = $1 AND r.media_type = $2 AND r.channel_id IS NULL
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT 1
          )
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
