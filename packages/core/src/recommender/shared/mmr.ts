/**
 * Diversity selection as maximal marginal relevance, on the same scale as the
 * thing it competes with.
 *
 * ## What this replaces, and why it had to go
 *
 * The previous selector blended `finalScore` against a genre-overlap score:
 *
 *     selectionScore = finalScore * (1 - w) + diversityBoost * w
 *     diversityBoost = 1 - (genres already covered / genres on this title)
 *
 * with "covered" being a plain `Set.has`. Three things followed from that, and
 * the third is what made it a bug rather than a preference.
 *
 * 1. **Membership was binary.** One Drama covered Drama for the rest of the
 *    list, however many more arrived. The counts were tracked and then thrown
 *    away.
 * 2. **The boost was effectively bimodal.** After five or six picks the common
 *    genres are all covered, so nearly every remaining candidate scores 0 while
 *    anything carrying an unrepresented genre scores 1.
 * 3. **The two terms were on wildly different scales.** Measured on a live
 *    instance from the insights panel itself, `finalScore` ran 0.905 at rank 1
 *    to 0.82 at rank 200 — a spread of **0.08** across the entire realistic
 *    contender set — while the diversity term spanned the full 0 to 1. At a
 *    configured weight of 0.2 that is 0.064 of relevance against 0.20 of
 *    diversity: the "20% weight" was worth three times the whole score range
 *    of the top 200.
 *
 * The arithmetic of (3) is worth stating exactly, because it shows the weight
 * was not a weight. A candidate with an uncovered genre beats one without
 * whenever `0.8b + 0.2 > 0.8B`, i.e. whenever `b > B - 0.25`. With the top 200
 * spanning 0.08, that is thousands of titles. So once a genre was covered, no
 * title sharing that exact genre set could be picked again while anything with
 * an uncovered genre remained — regardless of score. A 20% slider was behaving
 * as a hard lexicographic sort: genre coverage first, match second.
 *
 * That also explains something separate that looked mysterious: picks
 * overlapping heavily between users. Genre coverage is a property of the
 * *library*, not of a person, so the set of "decently-scored titles carrying a
 * rare genre" is nearly identical for everyone.
 *
 * ## What replaces it
 *
 * Maximal marginal relevance, the standard formulation the old code was an
 * approximation of:
 *
 *     score(d) = (1 - w) * relevance(d) - w * gain * max sim(d, s)
 *
 * over already-selected `s`. Three properties, each fixing one of the above:
 *
 * 1. **Continuous.** No membership test, no step function, no permanently
 *    closed category.
 * 2. **It measures actual redundancy.** Two near-identical films are penalised;
 *    two genuinely different dramas are not. Genre overlap could not tell those
 *    apart, since it scores both pairs the same.
 * 3. **`gain` puts the penalty on the relevance term's scale**, so `w` finally
 *    means what the slider says. This is the same correction
 *    `effectiveBlendWeights` applies to the *blend* — it was simply never
 *    applied one layer up, at the selection blend, where the mismatch was far
 *    worse.
 *
 * It also removes one of the three separate places genre entered the score
 * (novelty rewards unfamiliar genres, the preference nudge rewards familiar
 * ones, and this rewarded uncovered ones). Genre spread still emerges, because
 * same-genre titles sit close in embedding space — it is just no longer a
 * separate vote.
 *
 * Pure: similarity arrives as a lookup so this file needs no database and no
 * embedding format, and the interesting decisions stay testable.
 */

/** Anything the selector can order. */
export interface MmrCandidate {
  id: string
  title: string
  year: number | null
  finalScore: number
}

export interface MmrResult<T extends MmrCandidate> {
  selected: T[]
  /** 1-based selection order. */
  selectedRanks: Map<string, number>
  /**
   * The blended value each pick actually won on.
   *
   * Diagnostics only, and NOT comparable with `finalScore` — it carries the
   * redundancy penalty, so rendering it as a match percentage would make the
   * badge sink whenever the diversity weight rose, with nothing about content
   * fit having changed. Its other job is to be the marker that the selector
   * looked at a candidate at all: storage reads it to tell a measured variety
   * score from a never-measured one.
   */
  selectionScores: Map<string, number>
  /**
   * How unlike the rest of the finished list each pick is, 0-1.
   *
   * Measured against the FINAL selection rather than against whatever happened
   * to be chosen already, so it means the same thing for the first pick as for
   * the last. Scored incrementally it would read 1.0 for the top pick every
   * time — "maximally varied" for the one title that had nothing to be varied
   * from, which is the same kind of confident non-measurement that once put
   * "Variety 0%" on picks the selector never looked at.
   */
  variety: Map<string, number>
}

/**
 * How many of the top-ranked candidates diversity is allowed to reorder.
 *
 * The old selector walked the entire scored pool — every one of ~12,500 titles
 * — at every step, which is what let a rank-3000 title win a slot outright.
 * Reranking a shortlist is both the standard shape for MMR and the fix for
 * that: diversity reorders good matches, it does not import bad ones.
 *
 * Sized from the list length rather than fixed, so asking for 50
 * recommendations widens the pool proportionally instead of squeezing them out
 * of a fixed 300.
 */
export const MMR_POOL_PER_SLOT = 15
export const MMR_MIN_POOL = 150

export function mmrPoolSize(targetCount: number): number {
  return Math.max(MMR_MIN_POOL, Math.ceil(targetCount * MMR_POOL_PER_SLOT))
}

/**
 * Bounds on the penalty gain.
 *
 * Same reasoning as `MIN_NOVELTY_GAIN`/`MAX_NOVELTY_GAIN` in scoring.ts: the
 * correction is for a structural scale difference, not a licence to amplify
 * noise. A shortlist whose titles are all equidistant has no redundancy signal
 * to report, and dividing by that near-zero spread would hand the ordering to
 * floating-point dust.
 */
export const MIN_PENALTY_GAIN = 0.25
export const MAX_PENALTY_GAIN = 40

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.round(fraction * (sorted.length - 1))
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))]
}

/** p90 - p10, matching how spread is measured everywhere else in the recommender. */
export function spreadOfValues(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (finite.length === 0) return 0
  return percentile(finite, 0.9) - percentile(finite, 0.1)
}

/**
 * The factor that puts the redundancy penalty on the relevance term's scale.
 *
 * Returns 1 — no correction — when either spread is unmeasurable, which is the
 * honest answer rather than a fabricated one. A constant penalty cannot change
 * an ordering anyway, so 1 is also harmless.
 */
export function penaltyGain(relevanceSpread: number, penaltySpread: number): number {
  if (!Number.isFinite(relevanceSpread) || relevanceSpread <= 0) return 1
  if (!Number.isFinite(penaltySpread) || penaltySpread <= 0) return 1

  const gain = relevanceSpread / penaltySpread
  return Math.max(MIN_PENALTY_GAIN, Math.min(MAX_PENALTY_GAIN, gain))
}

/**
 * Every pairwise similarity within the shortlist, as a flat list.
 *
 * Used only to measure the penalty's spread before selection starts. Bounded by
 * the shortlist size, so this is a few tens of thousands of lookups rather than
 * anything resembling the library.
 */
export function pairwiseSimilarities(
  ids: string[],
  similarity: (a: string, b: string) => number
): number[] {
  const values: number[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const value = similarity(ids[i], ids[j])
      if (Number.isFinite(value)) values.push(value)
    }
  }
  return values
}

/**
 * Pick `targetCount` titles, trading match quality against redundancy.
 *
 * `similarity` returns cosine between two candidate ids; anything it cannot
 * answer for must return 0, which reads as "no redundancy known" and lets a
 * title with a missing embedding compete on relevance alone rather than being
 * silently excluded.
 */
export function selectWithMmr<T extends MmrCandidate>(
  candidates: T[],
  targetCount: number,
  diversityWeight: number,
  similarity: (a: string, b: string) => number
): MmrResult<T> {
  const selected: T[] = []
  const selectedRanks = new Map<string, number>()
  const selectionScores = new Map<string, number>()
  const variety = new Map<string, number>()

  if (targetCount <= 0 || candidates.length === 0) {
    return { selected, selectedRanks, selectionScores, variety }
  }

  const ranked = [...candidates].sort((a, b) => b.finalScore - a.finalScore)
  const shortlist = ranked.slice(0, mmrPoolSize(targetCount))

  const weight = Number.isFinite(diversityWeight)
    ? Math.min(1, Math.max(0, diversityWeight))
    : 0

  const gain = penaltyGain(
    spreadOfValues(shortlist.map((candidate) => candidate.finalScore)),
    spreadOfValues(pairwiseSimilarities(shortlist.map((candidate) => candidate.id), similarity))
  )

  const remaining = new Map(shortlist.map((candidate) => [candidate.id, candidate]))
  // Different cuts of the same film, or a re-release, are the same watch.
  const takenTitles = new Set<string>()

  while (selected.length < targetCount && remaining.size > 0) {
    let best: T | null = null
    let bestScore = -Infinity

    for (const candidate of remaining.values()) {
      const titleKey = `${candidate.title.toLowerCase()}|${candidate.year ?? 'unknown'}`
      if (takenTitles.has(titleKey)) continue

      let redundancy = 0
      for (const chosen of selected) {
        const value = similarity(candidate.id, chosen.id)
        if (Number.isFinite(value) && value > redundancy) redundancy = value
      }

      const score = (1 - weight) * candidate.finalScore - weight * gain * redundancy
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }

    if (!best) break

    remaining.delete(best.id)
    takenTitles.add(`${best.title.toLowerCase()}|${best.year ?? 'unknown'}`)
    selectedRanks.set(best.id, selected.length + 1)
    selectionScores.set(best.id, bestScore)
    selected.push(best)
  }

  // Variety against the finished list, so every pick is measured the same way.
  for (const candidate of selected) {
    let nearest = 0
    for (const other of selected) {
      if (other.id === candidate.id) continue
      const value = similarity(candidate.id, other.id)
      if (Number.isFinite(value) && value > nearest) nearest = value
    }
    variety.set(candidate.id, Math.min(1, Math.max(0, 1 - nearest)))
  }

  return { selected, selectedRanks, selectionScores, variety }
}

/**
 * A cosine lookup over already-fetched embeddings.
 *
 * Vectors are normalised once on the way in, so the hot loop is a dot product
 * rather than two square roots per pair — the selector asks for the same pair
 * many times over a run.
 *
 * An id with no embedding answers 0, which reads as "no redundancy known" and
 * lets the title compete on relevance alone. Excluding it instead would drop a
 * perfectly good recommendation because of a missing row.
 */
export function similarityFromEmbeddings(
  embeddings: Map<string, number[]>
): (a: string, b: string) => number {
  const unit = new Map<string, Float64Array>()

  for (const [id, vector] of embeddings) {
    let sum = 0
    for (const value of vector) sum += value * value
    if (!(sum > 0)) continue

    const inverse = 1 / Math.sqrt(sum)
    const normalised = new Float64Array(vector.length)
    for (let d = 0; d < vector.length; d++) normalised[d] = vector[d] * inverse
    unit.set(id, normalised)
  }

  return (a: string, b: string): number => {
    if (a === b) return 1
    const left = unit.get(a)
    const right = unit.get(b)
    if (!left || !right || left.length !== right.length) return 0

    let dot = 0
    for (let d = 0; d < left.length; d++) dot += left[d] * right[d]
    return dot
  }
}

/**
 * The ids diversity is allowed to reorder: the top of the ranking, and nothing
 * below it.
 *
 * Exported so a caller can fetch exactly those embeddings rather than the whole
 * library — the shortlist is a few hundred vectors where the scored pool is
 * every title in the catalogue.
 */
export function shortlistIds<T extends MmrCandidate>(
  candidates: T[],
  targetCount: number
): string[] {
  return [...candidates]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, mmrPoolSize(targetCount))
    .map((candidate) => candidate.id)
}
