/**
 * Does `EVIDENCE_CAUSAL_MIN_COSINE` still describe the embedding set in use?
 *
 * The threshold is a raw cosine and raw cosines are not on an absolute scale,
 * so switching embedding model moves every similarity underneath the constant
 * while changing no code that reads it. Nothing throws, nothing logs, and the
 * only symptom is prose: picks quietly stop (or start) being told the evidence
 * is the reason they were chosen.
 *
 * That is not hypothetical. Between the two derivations recorded in
 * `evidenceStrength.ts` the active set moved from gemini-embedding-001 to
 * gemini-embedding-2, the whole distribution shifted up, and the bar drifted
 * from "just above a mediocre neighbour" to rejecting same-franchise and
 * same-director matches. It took three ad-hoc SQL queries to establish, months
 * after the fact. One line at boot is the cheaper version of that.
 *
 * Deliberately a WARNING and not a behaviour change. The obvious alternative --
 * fall back to the hedged heading whenever the sets disagree -- is the "safe"
 * direction on paper, and would have been wrong in practice: the one model swap
 * this has actually seen left the threshold serviceable, so hedging every pick
 * in the library on suspicion alone would have degraded every explanation to
 * fix nothing. A mismatch means "nobody has checked", not "the number is wrong".
 */

import { getActiveEmbeddingModelId } from '../lib/ai-provider.js'
import { createChildLogger } from '../lib/logger.js'
import {
  EVIDENCE_CAUSAL_MIN_COSINE,
  EVIDENCE_THRESHOLD_EMBEDDING_SET,
} from './evidenceStrength.js'

const logger = createChildLogger('evidence-threshold')

export type EvidenceThresholdProvenance =
  | { state: 'match'; activeSet: string }
  | { state: 'diverged'; activeSet: string; derivedFor: string }
  | { state: 'unknown' }

/**
 * Compare the set the threshold was derived on against the set now in use.
 *
 * Pure, so the decision is testable without a database -- same split as
 * `sourceFloor.ts` and `pending.ts`. A null active id (no embeddings role
 * configured yet, which is every instance before setup finishes) reads as
 * `unknown` rather than as a mismatch: there is nothing to disagree with.
 */
export function compareEvidenceThresholdSet(
  activeSetId: string | null | undefined,
  derivedFor: string = EVIDENCE_THRESHOLD_EMBEDDING_SET
): EvidenceThresholdProvenance {
  const active = activeSetId?.trim()
  if (!active) return { state: 'unknown' }
  if (active === derivedFor) return { state: 'match', activeSet: active }
  return { state: 'diverged', activeSet: active, derivedFor }
}

/**
 * Read the active embedding set and log the comparison. Called once at boot.
 *
 * Never throws: this is a diagnostic, and an instance that cannot resolve its
 * embedding config has larger problems than an unverifiable heading.
 */
export async function checkEvidenceThresholdProvenance(): Promise<EvidenceThresholdProvenance> {
  let activeSetId: string | null = null
  try {
    activeSetId = await getActiveEmbeddingModelId()
  } catch (err) {
    logger.debug({ err }, 'Could not resolve the active embedding set')
    return { state: 'unknown' }
  }

  const result = compareEvidenceThresholdSet(activeSetId)

  if (result.state === 'diverged') {
    logger.warn(
      {
        threshold: EVIDENCE_CAUSAL_MIN_COSINE,
        derivedFor: result.derivedFor,
        activeSet: result.activeSet,
      },
      `EVIDENCE_CAUSAL_MIN_COSINE (${EVIDENCE_CAUSAL_MIN_COSINE}) was derived on ${result.derivedFor}, ` +
        `but the active embedding set is ${result.activeSet}. A raw cosine only means something ` +
        `relative to the model that produced it, so the "Why We Think You'll Like This" heading and ` +
        `the explanation prompt may be over- or under-claiming. Re-derive it (see evidenceStrength.ts ` +
        `for the method) and update EVIDENCE_THRESHOLD_EMBEDDING_SET.`
    )
  }

  return result
}
