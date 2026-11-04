import type { StoredAnalysis } from '@aperture/core'

/**
 * Which model, which retrieval mode, how much text it read, how long it took.
 * Admins only, and the route decides that: these describe our infrastructure, not
 * the film. Null timing means not measured, so it is passed as it is.
 */
export function analysisProvenance(stored: StoredAnalysis) {
  return {
    model: stored.model,
    retrievalMode: stored.retrievalMode,
    sourceCount: stored.sourceCount,
    retrievedChars: stored.retrievedChars,
    promptVersion: stored.promptVersion,
    retrievalMs: stored.retrievalMs,
    writeMs: stored.writeMs,
  }
}
