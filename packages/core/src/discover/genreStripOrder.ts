/**
 * Ordering the Discovery genre strips by what the viewer actually watches.
 *
 * The strips are an admin-configured browse surface — a row per genre, the same
 * rows for everyone, straight from TMDb Discover. That is the right shape for a
 * browse, but it sat beside the taste-scored list under a tab bar that gave no
 * hint which was which, so "Popular by genre" read as a personalized surface
 * that had simply stopped working.
 *
 * This orders the ROWS and never touches the titles inside them. The
 * distinction is the whole design: a strip still shows what TMDb says is
 * popular in that genre, so the surface keeps its job, and the viewer's own
 * taste decides which genre they have to scroll to. Scoring the titles too
 * would make this a second personalized list with a second embedding bill, and
 * the recommender and the Discover list already are that.
 *
 * Pure and import-free (the `GenreStripRowConfig` import is type-only and
 * erased) so the ordering can be pinned without a database or a TMDb key.
 */

import type { GenreStripRowConfig } from '../settings/systemSettings.js'

/**
 * Neutral weight. `user_genre_weights` holds a band around 1.0 (see
 * `genrePreference.ts`, which clamps to [0.7, 1.3]), so 1.0 is "no opinion" and
 * is what an absent row must resolve to — the same mapping that module makes
 * for an uncomputable ratio.
 */
const NEUTRAL_WEIGHT = 1

/**
 * A row's affinity is the MAX across its genres, never the mean.
 *
 * A row can name several genres ("Action, Adventure"), and someone who loves
 * Action and is indifferent to Adventure should see that row high. Averaging
 * would dilute exactly the signal the row was configured to carry — the same
 * argument `maxTasteSimilarity` makes for taking a candidate's best-matching
 * facet rather than its average one.
 *
 * An unrecognised genre contributes nothing rather than dragging the row down:
 * a name this instance has no weight for is unknown, not disliked.
 */
export function genreStripRowAffinity(
  row: GenreStripRowConfig,
  genreNameById: Map<number, string>,
  weightByGenreName: Map<string, number>
): number {
  let best: number | null = null

  for (const id of row.genreIds ?? []) {
    const name = genreNameById.get(id)
    if (!name) continue
    const weight = weightByGenreName.get(name.trim().toLowerCase())
    if (weight === undefined || !Number.isFinite(weight)) continue
    if (best === null || weight > best) best = weight
  }

  return best ?? NEUTRAL_WEIGHT
}

/**
 * The admin's rows, strongest genre first.
 *
 * Stable: ties keep the configured order, which is what makes this a
 * REORDERING rather than a replacement. The admin chose both the rows and their
 * sequence, and taste only gets to speak where it has an opinion — a viewer
 * with no weights at all, or one whose genres this instance cannot resolve,
 * gets the configured order back untouched, because every row then scores
 * NEUTRAL_WEIGHT and a stable sort of equal keys is the identity.
 *
 * Nothing is dropped. Hiding a row is a decision about what someone may browse;
 * ordering one is a decision about what they see first, and only the second is
 * this function's business.
 */
export function orderGenreStripRowsByTaste(
  rows: GenreStripRowConfig[],
  genreNameById: Map<number, string>,
  weightByGenreName: Map<string, number>
): GenreStripRowConfig[] {
  if (rows.length < 2 || weightByGenreName.size === 0) return rows

  // Decorated so the affinity is computed once per row rather than once per
  // comparison, and so the index is available as an explicit tiebreak rather
  // than relying on the sort's stability alone.
  const decorated = rows.map((row, index) => ({
    row,
    index,
    affinity: genreStripRowAffinity(row, genreNameById, weightByGenreName),
  }))

  decorated.sort((a, b) => b.affinity - a.affinity || a.index - b.index)

  return decorated.map((d) => d.row)
}
