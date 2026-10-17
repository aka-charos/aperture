/**
 * Onboarding state and checklist facts. The rules are in `rules.ts`; this is
 * only the reading and writing.
 *
 * Its own table (`user_onboarding`, `0205`) rather than a key in
 * `user_settings`, because the recommendation activity gate reads
 * `MAX(user_settings.updated_at)` and a dismissed hint is not a reason to
 * regenerate anyone's recommendations.
 */

import { query, queryOne } from '../lib/db.js'
import { getSystemSetting, getWatchingLibraryConfig } from '../settings/systemSettings.js'
import { WATCH_HISTORY_PLAYED_SQL } from '../recommender/watchedExclusion.js'
import { RECOMMENDATION_RECIPIENT_SQL } from '../recommender/recipients.js'
import {
  RATINGS_GOAL,
  buildChecklist,
  decideOnboardingMode,
  mergeOnboardingState,
  readOnboardingState,
  type Checklist,
  type OnboardingPatch,
  type OnboardingState,
} from './rules.js'

export interface OnboardingSummary {
  mode: 'tour' | 'offer' | 'none'
  state: OnboardingState
  checklist: Checklist
  /** Whether Shows You Watch is switched on for the instance (a feature, not a permission). */
  watchingEnabled: boolean
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const row = await queryOne<{ state: unknown }>(`SELECT state FROM user_onboarding WHERE user_id = $1`, [userId])
  return readOnboardingState(row?.state)
}

/** Apply a patch and return the state as stored. */
export async function updateOnboardingState(userId: string, patch: OnboardingPatch): Promise<OnboardingState> {
  const current = await getOnboardingState(userId)
  const next = mergeOnboardingState(current, patch)
  await query(
    `INSERT INTO user_onboarding (user_id, state, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
    [userId, JSON.stringify(next)]
  )
  return next
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Everything the client needs to decide what to show, decided here: whether
 * the tour starts, which checklist items are done, whether Shows You Watch is
 * on. `capabilities` are the session's (the assistant item follows them).
 */
export async function getOnboardingSummary(
  userId: string,
  capabilities: { assistant: boolean }
): Promise<OnboardingSummary> {
  const [state, user, introduced, watching, facts] = await Promise.all([
    getOnboardingState(userId),
    queryOne<{ first_login_at: Date | null; receives: boolean }>(
      `SELECT first_login_at, (${RECOMMENDATION_RECIPIENT_SQL}) AS receives FROM users WHERE id = $1`,
      [userId]
    ),
    getSystemSetting('onboarding_introduced_at'),
    getWatchingLibraryConfig().catch(() => null),
    // Asked on every app load, so each answer stops at the first row it
    // needs: EXISTS for the yes/no items, and ratings counted no further
    // than the goal. A run with a channel_id built a playlist or a
    // collection, not this person's recommendations, so it does not make
    // them "ready".
    queryOne<{
      played: boolean
      ratings: string
      interests: boolean
      conversations: boolean
      watching: boolean
      runs: boolean
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM watch_history wh WHERE wh.user_id = $1 AND ${WATCH_HISTORY_PLAYED_SQL}) AS played,
         (SELECT COUNT(*) FROM (SELECT 1 FROM user_ratings WHERE user_id = $1 LIMIT $2) r) AS ratings,
         EXISTS (SELECT 1 FROM user_custom_interests WHERE user_id = $1) AS interests,
         EXISTS (SELECT 1 FROM assistant_conversations WHERE user_id = $1) AS conversations,
         EXISTS (SELECT 1 FROM user_watching_series WHERE user_id = $1) AS watching,
         EXISTS (
           SELECT 1 FROM recommendation_runs
            WHERE user_id = $1 AND status = 'completed' AND channel_id IS NULL
         ) AS runs`,
      [userId, RATINGS_GOAL]
    ),
  ])

  // COUNT(*) arrives as a string (bigint); a missing row is no rows.
  const yes = (value: boolean | undefined) => (value === true ? 1 : 0)
  const watchingEnabled = watching?.enabled ?? true

  return {
    mode: decideOnboardingMode({
      firstLoginAt: user?.first_login_at ?? null,
      introducedAt: parseDate(introduced),
      state,
    }),
    state,
    watchingEnabled,
    checklist: buildChecklist(
      {
        playedTitles: yes(facts?.played),
        ratings: Number(facts?.ratings ?? 0),
        interests: yes(facts?.interests),
        conversations: yes(facts?.conversations),
        watchingSeries: yes(facts?.watching),
        hasRecommendations: facts?.runs === true,
        receivesRecommendations: user?.receives === true,
      },
      state,
      { assistant: capabilities.assistant, watching: watchingEnabled }
    ),
  }
}
