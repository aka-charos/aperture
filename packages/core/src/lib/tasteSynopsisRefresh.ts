/**
 * Keep the Watcher Identity written, without anyone pressing a button.
 *
 * The synopsis is not a display card. Five things read it and every one of them
 * degrades silently when it is null: both explanation generators unshift it to
 * the *top* of their prompt context, the assistant's system prompt substitutes
 * the literal sentence "No movie taste profile available yet.", the discovery
 * taste brief drops to signature titles alone (and with none returns null, so
 * the turn is not personalised at all), and AI channel generation loses its
 * taste block. A viewer who never finds the Generate Identity button on Watch
 * Stats therefore gets worse recommendation explanations, a worse assistant and
 * an unpersonalised discovery brief, with nothing anywhere saying so.
 *
 * That it was manual looks like an accident rather than a decision. Two other
 * places in this repo already assume otherwise: `getTasteSynopsis` carried a
 * docstring promising "background job handles periodic refresh based on the
 * user's refresh_interval_days setting" -- no such job was ever written -- and
 * the admin cost estimator bills `enabledUsers * runsPerWeek` synopsis calls,
 * i.e. one per user per recommendation run, so the projected spend has a line
 * item for work that never happened.
 *
 * The trigger here is the taste profile CHANGING, not a clock. The synopsis is
 * prose describing that centroid, so re-describing an unchanged vector is a
 * paid call that cannot say anything new; `isProfileStale` already paces the
 * rebuild (refresh_interval_days, 30 by default), and this rides on it.
 */

import { queryOne } from './db.js'
import { createChildLogger } from './logger.js'
import { isAIFunctionConfigured } from './ai-provider.js'
import { streamTasteSynopsis } from './tasteSynopsis.js'
import { streamSeriesTasteSynopsis } from './tasteSeriesSynopsis.js'

const logger = createChildLogger('taste-synopsis-refresh')

export type SynopsisMediaType = 'movie' | 'series'

/** What the refresh did, for the caller's log line. */
export type SynopsisRefreshOutcome =
  | 'written'
  | 'current'
  | 'not-configured'
  | 'cancelled'
  | 'failed'

export interface SynopsisFreshnessInput {
  /** The stored synopsis text, exactly as the column holds it. */
  synopsis: string | null
  /** When that text was written. */
  synopsisUpdatedAt: Date | null
  /** `user_taste_profiles.auto_updated_at` for this user and media type. */
  profileUpdatedAt: Date | null
}

/**
 * Should the synopsis be rewritten?
 *
 * Pure, exported and pinned, because every branch is a decision about spending
 * money on someone's behalf and both failure directions are silent: refuse when
 * it should write and the viewer keeps an identity describing a profile they no
 * longer have; write when it should refuse and every run re-pays to say the
 * same thing.
 */
export function synopsisNeedsRefresh({
  synopsis,
  synopsisUpdatedAt,
  profileUpdatedAt,
}: SynopsisFreshnessInput): boolean {
  // Empty is missing. The store now refuses to write '' (F-110), but rows
  // written before that guard can hold one, and `getTasteSynopsis` already
  // reads an empty string as "never generated" -- so this must agree with it,
  // or the card offers Generate for something this function calls current.
  if (!synopsis?.trim()) return true

  // No profile timestamp is not evidence of staleness. It means the profile has
  // never been auto-built (a locked profile, or one only ever set by hand), and
  // there is nothing the existing text could be out of date with respect to.
  if (!profileUpdatedAt) return false

  // Text with no stamp cannot be shown to be current, and the asymmetry favours
  // rewriting: one call against an identity that may describe a stale centroid.
  if (!synopsisUpdatedAt) return true

  // Strictly newer. The synopsis is written after the rebuild that prompted it,
  // so equal stamps mean this text already describes that profile; `>=` would
  // re-pay on every run for a profile nobody rebuilt.
  return profileUpdatedAt.getTime() > synopsisUpdatedAt.getTime()
}

interface SynopsisColumns {
  synopsis: string | null
  synopsis_updated_at: Date | null
}

/**
 * Regenerate this user's synopsis if their taste profile has moved under it.
 *
 * Fails open in every direction: an unconfigured model, a cancelled job, a
 * provider outage and an empty generation all leave whatever is already stored
 * and return without throwing. A recommendation run that produced good picks
 * must not be failed by the paragraph that describes them -- the same rule
 * `generateChannelPickReasons` follows.
 */
export async function refreshTasteSynopsis(
  userId: string,
  mediaType: SynopsisMediaType,
  options: { shouldCancel?: () => boolean } = {}
): Promise<SynopsisRefreshOutcome> {
  // One short call per user per media type, so the caller's own per-user loop is
  // the seam Stop needs; there is no inner loop to poll. Checked here rather
  // than left to the caller because every caller would have to remember.
  if (options.shouldCancel?.()) return 'cancelled'

  const isSeries = mediaType === 'series'
  const column = isSeries ? 'series_taste_synopsis' : 'taste_synopsis'

  // Read the profile timestamp back from the table rather than taking it as an
  // argument: the caller has usually just been through getUserTasteProfile,
  // which may have rebuilt, and the legacy fallback branch in both pipelines
  // stores a profile without ever holding a TasteProfile object to read it off.
  const profile = await queryOne<{ auto_updated_at: Date | null }>(
    `SELECT auto_updated_at FROM user_taste_profiles WHERE user_id = $1 AND media_type = $2`,
    [userId, mediaType]
  )

  const stored = await queryOne<SynopsisColumns>(
    `SELECT ${column} AS synopsis, ${column}_updated_at AS synopsis_updated_at
     FROM user_preferences WHERE user_id = $1`,
    [userId]
  )

  const needsRefresh = synopsisNeedsRefresh({
    synopsis: stored?.synopsis ?? null,
    synopsisUpdatedAt: stored?.synopsis_updated_at ?? null,
    profileUpdatedAt: profile?.auto_updated_at ?? null,
  })

  if (!needsRefresh) return 'current'

  // Checked before calling, not left to the generator. Both generators answer an
  // unconfigured model by storing the deterministic fallback blurb, which is the
  // right answer for someone who pressed a button and is watching -- and the
  // wrong one here, because storing it stamps the row current, so the real
  // synopsis would never be written once a model was finally configured.
  if (!(await isAIFunctionConfigured('textGeneration'))) {
    logger.debug({ userId, mediaType }, 'Text generation not configured, leaving synopsis alone')
    return 'not-configured'
  }

  try {
    // The generator yields chunks for the SSE route to forward to a browser.
    // There is no browser here, so it is drained for its side effect: it writes
    // the finished text itself, which keeps one storage path for both callers.
    const generator = isSeries ? streamSeriesTasteSynopsis(userId) : streamTasteSynopsis(userId)
    for (;;) {
      const next = await generator.next()
      if (next.done) break
    }
  } catch (error) {
    // Includes the empty-generation throw (F-110). Nothing was stored, so the
    // previous identity stands and the next run tries again.
    logger.warn({ error, userId, mediaType }, 'Taste synopsis refresh failed, keeping stored text')
    return 'failed'
  }

  logger.info({ userId, mediaType }, '📝 Taste synopsis refreshed')
  return 'written'
}
