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
 * That first derivation produced 0.72 and was correct FOR THE MODEL IT WAS
 * MEASURED ON. It has since been re-derived once, and the reason it had to be
 * is the durable lesson here: these numbers are not on an absolute scale, so
 * changing the embedding model moves every score underneath this constant
 * without changing a line of code that reads it. Nothing failed. Nothing
 * logged. The threshold simply stopped meaning what it was measured to mean.
 * That is what `EVIDENCE_THRESHOLD_EMBEDDING_SET` below exists to catch.
 *
 * SECOND DERIVATION -- openrouter:google/gemini-embedding-2 @3072, raw cosine,
 * measured 2026-09-07 over 581 picks on the newest completed run per viewer.
 * Method is the same one: look at real pairs either side of the line and ask
 * where a person stops recognising the connection.
 *
 * At 0.72 the bar had drifted UP relative to the new model's distribution, and
 * was rejecting matches nobody would call weak:
 *
 *   Furiosa             -> Mad Max                  0.717   same franchise
 *   Top Gun: Maverick   -> M:I Dead Reckoning       0.713
 *   Thunderbolts        -> Guardians of the Galaxy  0.712
 *   Mulholland Drive    -> Blue Velvet              0.711   same director
 *   Blade Runner 2049   -> Dune: Part Two           0.711   same director
 *   Nobody              -> John Wick                0.709
 *   The Irishman        -> Gangs of New York        0.707   same director
 *
 * while admitting looser ones above it (Children of Men -> Inception 0.737,
 * Whiplash -> Flight 0.735). Two contradictions showed the line was cutting
 * through a cluster rather than sitting in a gap: The Martian -> Prometheus
 * passed at 0.722 while Gravity -> Prometheus failed at 0.715, and one film
 * was causal evidence in one direction and not the other 0.018 apart.
 *
 * Quality falls off below 0.703, not below 0.72. The band underneath is where
 * "both are films released recently" starts winning -- The Batman -> M:I 0.690,
 * One Battle After Another -> A Working Man 0.689, Coco -> Finding Dory 0.690 --
 * and by 0.67 it is Thirteen Lives -> Death on the Nile. So the bar moves to
 * 0.70, which sits in the empty gap between 0.691 and 0.703.
 *
 * WHAT NO THRESHOLD FIXES, and the reason not to keep tuning this: strong pairs
 * appear at every level. Die Hard -> Live Free or Die Hard sits at 0.680,
 * Decalogue I -> The Double Life of Veronique (both Kieslowski) at 0.672,
 * Paris, Texas -> Perfect Days (both Wenders) at 0.658. Any bar that rejects
 * Marriage Story -> Poor Things at 0.673 also rejects two of those. A single
 * cosine cannot sort these cleanly; 0.70 moves the line to where the MAJORITY
 * flips, which is all it claims to do.
 *
 * On erring high, which the first derivation argued for: it is still the safer
 * side, but it is not free, and that was overstated. The claim was that a
 * too-high bar costs nothing because the same three titles still appear under
 * "Closest in your library". True of the panel, false of the prose -- the same
 * boolean picks the heading in the EXPLANATION PROMPT (`evidenceHeading`), so
 * at 0.72 the model was being told the Furiosa/Mad Max connection is NOT why
 * the film was picked, and wrote around the obvious answer.
 *
 * Note this is a RAW cosine (`storeEvidence` reads `embeddings_*.embedding`,
 * not `embedding_centered`). Mean-centring roughly doubles the spread, so if
 * centred vectors ever back this lookup the constant is again measured against
 * the wrong distribution and MUST be re-derived rather than carried over.
 */
export const EVIDENCE_CAUSAL_MIN_COSINE = 0.7

/**
 * The embedding set `EVIDENCE_CAUSAL_MIN_COSINE` was last derived against.
 *
 * The threshold is a raw cosine, and a raw cosine only means something relative
 * to the model that produced it. Swapping models is a config change with no
 * code change, so without this the constant silently describes a distribution
 * that no longer exists -- which is exactly what happened between the first and
 * second derivations above, and took three ad-hoc queries to notice.
 *
 * Format matches `embeddingSetId()` so the two are directly comparable.
 * `checkEvidenceThresholdProvenance` warns at boot when they diverge; it does
 * NOT change behaviour, because the second derivation showed a model swap can
 * leave the threshold serviceable, and forcing every pick in the library to the
 * hedged heading on suspicion alone would have been the wrong call that day.
 */
export const EVIDENCE_THRESHOLD_EMBEDDING_SET = 'openrouter:google/gemini-embedding-2'

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
