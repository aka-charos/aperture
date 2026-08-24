/**
 * Whether the stored evidence for a pick is close enough to be called a reason.
 *
 * `storeEvidence` runs a LATERAL kNN restricted to titles the viewer has
 * already watched and keeps the three nearest, WITH NO DISTANCE FLOOR. That is
 * the right query -- the panel wants the closest things in their history -- but
 * it means the result is "the best available", never "a good match", and the
 * two are indistinguishable once rendered. Under a heading reading "Why We
 * Think You'll Like This / Based on your history with similar movies", a viewer
 * whose history happens to contain nothing near the pick is told a cause that
 * was never established.
 *
 * Measured live, this is exactly what produced the complaint that started this
 * work. On a 12,589-title library (gemini-embedding-001 at 3072 dimensions,
 * raw cosine) the panel offered:
 *
 *   Metropolis          -> A Clockwork Orange 0.67, Das Boot 0.67
 *   Dancer in the Dark  -> In A Better World 0.694, Fargo 0.694
 *
 * Those are real near-neighbours -- library-wide they rank around 8th to 11th
 * of 12,589 -- but they are not what the film is *like*, and the same library
 * answers far better when it can reach past the viewer's history:
 *
 *   Metropolis          -> Woman in the Moon 0.767, Die Nibelungen 0.724
 *   Dancer in the Dark  -> Breaking the Waves 0.756, Dogville 0.738
 *   Stalker             -> Solaris 0.788, Mirror 0.740
 *   Poor Things         -> Kinds of Kindness 0.814
 *   Dune: Part Two      -> Dune 0.829
 *
 * So the split is visible: everything a person recognised as correct sits at
 * 0.75 and above, both complaints sit at 0.69 and below, and rank 10 of the
 * whole library lands at 0.68-0.72.
 *
 * The threshold below is therefore MEASURED, but from a small sample, and this
 * repo has twice been burned thresholding a compressed cosine band blind (twin
 * centroids spanning 0.898-0.993; `avgNovelty` pinned inside [0.8, 1.0]). Two
 * things make shipping a provisional number defensible anyway.
 *
 * (1) THE FAILURE IS ASYMMETRIC AND THE SAFE SIDE IS UP. Set too high, the
 *     panel shows the same three titles under "Closest in your library" and
 *     merely declines to call them the reason -- nothing is hidden and nothing
 *     is false. Set too low, it asserts a cause that isn't there, which is the
 *     bug. Err high.
 * (2) It governs one heading. No score, no ranking and no recommendation
 *     depends on it, so a wrong value cannot cost anyone a pick.
 *
 * Note this is a RAW cosine, and raw cosines here are badly compressed -- the
 * gap between an excellent match and a poor one is about 0.13. Mean-centring
 * the library roughly doubles that spread (Poor Things -> Kinds of Kindness
 * goes 0.814 vs 0.682 at rank 10 raw, and 0.563 vs 0.264 centred), so if
 * centred vectors ever back this lookup, this constant is measured against the
 * wrong distribution and MUST be re-derived rather than carried over.
 */
export const EVIDENCE_CAUSAL_MIN_COSINE = 0.72

/**
 * True when the closest stored evidence is near enough that calling it the
 * reason for the pick is honest.
 *
 * Reads the BEST similarity rather than an average: three evidence rows are the
 * top three of a kNN, so the second and third are bounded by the first, and a
 * mean would let one strong connection be dragged under the line by the two
 * filler rows that always accompany it.
 *
 * Accepts strings because pg returns NUMERIC as one, and `'0.6900' > 0.72` is
 * a string/number comparison that coerces in ways nobody wants to reason about.
 * Anything unparseable is treated as absent, never as zero.
 */
export function hasCausalEvidence(
  similarities: Array<number | string | null | undefined>,
  minCosine = EVIDENCE_CAUSAL_MIN_COSINE
): boolean {
  for (const raw of similarities) {
    if (raw == null) continue
    const value = typeof raw === 'number' ? raw : Number.parseFloat(raw)
    if (!Number.isFinite(value)) continue
    if (value >= minCosine) return true
  }
  return false
}
