/**
 * What a poll of the title-analysis GET should do next.
 *
 * WHY THIS IS ITS OWN MODULE. Writing an analysis takes minutes, so the POST
 * answers 202 and the panel polls for the result — and every way that wait can
 * end badly ends in a response that looks almost like every other one. Three of
 * the four branches below are a stop, two of them are failures, and both of
 * those failures present as an ABSENCE rather than as an error field:
 *
 *  - A failed generation writes no row at all, which is why the server keeps a
 *    short-lived `failure` for a poll to collect. Miss it and the spinner turns
 *    back into the button having said nothing.
 *  - An API restart mid-generation loses the in-memory record of both the work
 *    and its failure, so the response is byte-identical to "nobody has ever
 *    asked about this title". That is indistinguishable from the honest
 *    never-asked case on the data alone; what makes it a failure is that WE
 *    were waiting, which is context only the poller has.
 *
 * Getting either wrong is silent, and silent is exactly the defect the poll
 * replaced. So the decision is pure and pinned rather than inline in an effect.
 */

/** The fields of the analysis payload a poll actually reads. */
export interface PolledAnalysis {
  attempted?: boolean
  generating?: boolean
  failure?: string
}

export type PollOutcome =
  /** Still running. Ask again. */
  | { kind: 'wait' }
  /** Finished with something to show — an analysis, or a stored decline. */
  | { kind: 'done' }
  /**
   * Finished with nothing. `error` is the server's own sentence when it kept
   * one; absent means the caller should use its generic message, because
   * nobody recorded why.
   */
  | { kind: 'failed'; error?: string }

export function pollOutcome(json: PolledAnalysis): PollOutcome {
  // Checked first: a response can carry a finished row AND the flag, because
  // the server reads the flag before the row on purpose. Erring toward one
  // extra poll is the whole reason for that ordering.
  if (json.generating) return { kind: 'wait' }

  if (json.failure) return { kind: 'failed', error: json.failure }

  // Not generating, nothing stored, nothing recorded.
  if (!json.attempted) return { kind: 'failed' }

  // `attempted` with a null analysis is a stored DECLINE, which is an answer
  // and not a failure: the panel has its own copy for it.
  return { kind: 'done' }
}
