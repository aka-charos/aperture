/**
 * Splitting a viewer's history so the recommender can be scored against
 * something it was not shown.
 *
 * Everything here is pure, for the same reason `pending.ts` and
 * `watchedExclusion.ts` are: the interesting decisions are all in the split and
 * the grading, and neither needs a database to be wrong in an interesting way.
 *
 * ## Why a holdout at all
 *
 * The only films anyone has ground truth for are films the viewer engaged with.
 * A film they have never seen has no known answer. So a test set has to be made
 * of watched titles — and a watched title is only a test if the fingerprint was
 * not built from it. Hence the split. Production still uses every title; this
 * exists solely to measure.
 *
 * ## Why "watched" is not the label
 *
 * `WATCH_HISTORY_EXCLUDABLE_SQL` counts `played OR >= 5% progress`, so a film
 * abandoned after four minutes is "watched". Scoring a recommender on
 * predicting *those* is precisely how a system learns to serve more of what you
 * bounced off — the failure everyone recognises from commercial recommenders.
 *
 * And a favourite is not the answer either: in Emby people use it as a
 * bookmark. This repo already knows that — `WATCH_HISTORY_TASTE_SQL` keeps
 * `is_favorite` deliberately *out* of the "have you seen it" question, because
 * folding it in makes a bookmarked title unrequestable in Seerr.
 *
 * So no single label is trustworthy, and the answer is not to find a better one
 * but to stop pretending any of them is binary. Each signal carries a weight
 * saying how much it should be believed, and the metric is NDCG over those
 * graded relevances. A film bailed on scores 0 and contributes nothing; a
 * rewatch or a finished series scores 1 and dominates.
 */

/** One title in a viewer's history, with everything the grader needs. */
export interface WatchRecord {
  itemId: string
  /** Ordering key for the split. Null sorts oldest. */
  lastPlayedAt: Date | null
  playCount: number
  isFavorite: boolean
  /**
   * Fraction of the film watched, 0-1, or null when the media server reported
   * none. For a series this is the fraction of episodes finished.
   */
  progress: number | null
  /** True for a `played` flag from the media server, whatever the progress. */
  played: boolean
}

/**
 * How much each signal is believed, 0-1.
 *
 * These are deliberately configuration rather than constants: what a favourite
 * means differs between installs, and the disagreement about it should be a
 * parameter rather than an argument. Running the same evaluation under two
 * weightings is the robustness check — see SKEPTICAL_RELEVANCE_WEIGHTS.
 */
export interface RelevanceWeights {
  /** Finished the whole thing and marked it. The strongest signal available. */
  completedAndFavorited: number
  /** Went back to it. Nobody rewatches what they disliked. */
  rewatched: number
  /** Sat through all of it. Real, but inertia exists. */
  completed: number
  /** Marked but never played: a bookmark. Says *interested*, not *loved*. */
  favoritedUnplayed: number
  /** Started and did not finish. Nearly noise, but not quite nothing. */
  started: number
}

export const DEFAULT_RELEVANCE_WEIGHTS: RelevanceWeights = {
  completedAndFavorited: 1.0,
  rewatched: 1.0,
  completed: 0.5,
  favoritedUnplayed: 0.3,
  started: 0.1,
}

/**
 * The same evaluation with favourites barely believed at all.
 *
 * Run both. If a change wins under one weighting and loses under the other, the
 * result is an artifact of what we assumed a favourite meant, and should be
 * thrown away rather than argued about.
 */
export const SKEPTICAL_RELEVANCE_WEIGHTS: RelevanceWeights = {
  completedAndFavorited: 0.6,
  rewatched: 1.0,
  completed: 0.5,
  favoritedUnplayed: 0.02,
  started: 0.1,
}

/**
 * Progress at or above which a title counts as finished.
 *
 * Not 1.0: media servers stop counting during end credits, and a viewer who
 * quits two minutes before the end still watched the film.
 */
export const COMPLETION_THRESHOLD = 0.9

/**
 * Progress below which a title counts as abandoned rather than started.
 *
 * Matches the 5% floor `WATCH_HISTORY_EXCLUDABLE_SQL` uses to decide a title
 * has been seen at all — deliberately the same number, because a title under it
 * is one this codebase already treats as not-really-watched.
 */
export const ABANDONED_THRESHOLD = 0.05

/**
 * How much a title should count as a correct answer, 0 (not at all) to 1.
 *
 * The order of the checks is the priority order: a rewatched favourite is
 * graded on the strongest signal it has, not the last one tested.
 */
export function gradeRelevance(
  record: WatchRecord,
  weights: RelevanceWeights = DEFAULT_RELEVANCE_WEIGHTS
): number {
  const progress = Number.isFinite(record.progress) ? (record.progress as number) : null
  const completed = record.played || (progress != null && progress >= COMPLETION_THRESHOLD)

  if (record.playCount > 1) return weights.rewatched
  if (completed && record.isFavorite) return weights.completedAndFavorited
  if (completed) return weights.completed

  // Marked but never really started: a watchlist entry.
  if (record.isFavorite && (progress == null || progress < ABANDONED_THRESHOLD)) {
    return weights.favoritedUnplayed
  }

  if (progress != null && progress >= ABANDONED_THRESHOLD) return weights.started

  // Bailed out, or nothing recorded at all. Never an answer key.
  return 0
}

export interface GradedItem {
  itemId: string
  relevance: number
}

export interface HoldoutSplit {
  /**
   * The fingerprint is built from these, and they are excluded from the ranked
   * pool exactly as watched titles are in production.
   */
  train: WatchRecord[]
  /** The answer key: held-out titles that carry a positive relevance. */
  test: GradedItem[]
  /**
   * Held-out titles that graded 0 — bailed out of, mostly.
   *
   * Deliberately neither trained on nor scored. They stay in the ranked pool
   * because removing them would be the evaluation using knowledge the
   * fingerprint does not have, and a recommender that ranks them highly is
   * neither rewarded nor punished for it.
   */
  ignored: string[]
}

/**
 * Hold out a viewer's most recent `holdoutSize` engaged titles.
 *
 * A count, not a date. A shared cutoff date sounds natural and is wrong: it
 * hands a viewer who watches five films a week sixty-five test items and a
 * viewer who watches two a month six, so pooling the results measures the
 * algorithm on heavy users and anyone sporadic drops out of the sample
 * entirely. A per-viewer count gives everybody the same number of answers; the
 * time span each one covers simply differs, which is fine.
 *
 * "Most recent" rather than a random sample, for two reasons. It matches the
 * job — predict what comes next from what came before. And a random sample
 * leaks: hide one film of a twenty-film binge, leave the other nineteen in the
 * fingerprint, and finding it is near-duplicate lookup rather than prediction,
 * which would flatter every configuration equally.
 */
export function splitHoldout(
  history: WatchRecord[],
  holdoutSize: number,
  weights: RelevanceWeights = DEFAULT_RELEVANCE_WEIGHTS
): HoldoutSplit {
  if (holdoutSize <= 0 || history.length === 0) {
    return { train: [...history], test: [], ignored: [] }
  }

  const ordered = [...history].sort((a, b) => {
    const at = a.lastPlayedAt ? a.lastPlayedAt.getTime() : 0
    const bt = b.lastPlayedAt ? b.lastPlayedAt.getTime() : 0
    if (bt !== at) return bt - at
    // Stable and deterministic when timestamps tie, which they do for a whole
    // library imported in one sync.
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0
  })

  const test: GradedItem[] = []
  const ignored: string[] = []
  let cut = ordered.length

  for (let i = 0; i < ordered.length; i++) {
    const relevance = gradeRelevance(ordered[i], weights)
    if (relevance > 0) {
      test.push({ itemId: ordered[i].itemId, relevance })
      if (test.length >= holdoutSize) {
        cut = i + 1
        break
      }
    } else {
      ignored.push(ordered[i].itemId)
    }
  }

  // Not enough engaged titles to fill the holdout: everything walked is held
  // out and the caller decides whether that is enough to evaluate on.
  if (test.length < holdoutSize) cut = ordered.length

  return { train: ordered.slice(cut), test, ignored }
}

/**
 * Whether a viewer has enough held-out answers to say anything about them.
 *
 * Below this the per-user numbers are noise, and — more importantly — reporting
 * them alongside everyone else's invites exactly the aggregate-over-users
 * mistake this whole module is arranged to avoid.
 */
export const MIN_TEST_ITEMS = 8

export function qualifies(split: HoldoutSplit, minTestItems: number = MIN_TEST_ITEMS): boolean {
  return split.test.length >= minTestItems && split.train.length > 0
}
