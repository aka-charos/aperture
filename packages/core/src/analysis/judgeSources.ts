/**
 * Ask the optional decision model which retrieved documents are worth giving
 * to the writer, and drop the ones it rules out.
 *
 * The why, the thresholds and the rails are in ./sourceJudgment.ts (pure,
 * pinned). This file is the I/O: read the config, resolve the endpoint, make
 * one call, apply the decision.
 *
 * NEVER THROWS, AND FAILS OPEN IN EVERY DIRECTION. Off, not configured, no
 * key, unreachable, timed out, 400 on an oversized state, a body that is not
 * JSON, an answer with no verdicts - all of them return the documents exactly
 * as they arrived. That is not defensiveness: retrieval has already cost a
 * search and up to ten page fetches by the time this runs, and losing a title
 * over an optional second opinion would be the worst trade in the feature.
 *
 * ONE CALL PER TITLE, NOT PER DOCUMENT. System One answers its questions
 * independently and they share the state, so eleven documents are eleven
 * questions in one request - one round trip rather than eleven, and the
 * `concurrency` setting is left to the evidence judge, which genuinely has
 * dozens of separate requests to pace.
 *
 * IT RUNS LAST, after every free filter. The mechanical tests - bot walls,
 * worthless pages, one page per host, repeated titles, republished bodies -
 * are deterministic and cost nothing, so a document they would have dropped
 * must never be paid for here.
 */
import { createChildLogger } from '../lib/logger.js'
import {
  callSystemOne,
  getDecisionModelConfig,
  resolveDecisionEndpoint,
} from '../lib/decisionModel.js'
import type { AnalysisSource, AnalysisSubject } from './prompt.js'
import {
  buildSourceJudgmentRequest,
  decideJudgedSources,
  readSourceJudgments,
  type SourceJudgmentOutcome,
} from './sourceJudgment.js'

const logger = createChildLogger('analysis-sources')

export interface SourceFilterResult {
  /** What the prompt should carry. Identical to the input unless `status` is 'filtered'. */
  sources: AnalysisSource[]
  /**
   * off: the switch is off. unavailable: on, but it cannot be called.
   * nothing: too few documents for a drop to be possible. filtered: asked and
   * applied, which includes asking and dropping none. failed: asked and the
   * call did not answer.
   */
  status: 'off' | 'unavailable' | 'nothing' | 'filtered' | 'failed'
  /** Present for 'filtered'. */
  outcome?: SourceJudgmentOutcome
  reason?: string
  model?: string
  ms?: number
}

/**
 * Weed one title's retrieval.
 *
 * `sources` must be the CLEANED, deduplicated list - ./sourceCleanup.ts has to
 * have run, because the sample this sends is the head of each document and
 * before cleaning that head is reliably a navigation menu, which would read as
 * noise for every page alike.
 */
export async function filterSourcesByJudgment(
  subject: AnalysisSubject,
  sources: AnalysisSource[]
): Promise<SourceFilterResult> {
  try {
    const config = await getDecisionModelConfig()
    if (!config.enabled || !config.filterAnalysisSources) return { sources, status: 'off' }

    // A retrieval the floor would stop any drop on is not worth a call: the
    // answer could not change what reaches the prompt. Checked against the
    // pure decision's own floor by asking it with every score condemned.
    if (decideJudgedSources(sources.map((source) => ({ source, score: 0 }))).dropped.length === 0) {
      return { sources, status: 'nothing' }
    }

    const resolved = await resolveDecisionEndpoint(config)
    if (!resolved.ok) {
      logger.warn(
        { title: subject.title, reason: resolved.reason },
        'Source filtering is on but the decision model cannot be called; keeping every document'
      )
      return { sources, status: 'unavailable', reason: resolved.reason }
    }

    const request = buildSourceJudgmentRequest(subject, sources)
    const startedAt = Date.now()
    const answer = await callSystemOne(
      resolved.endpoint,
      { model: config.model, state: request.state, questions: request.questions },
      config.timeoutMs
    )
    const scores = readSourceJudgments(answer.answers, request.keys)
    const outcome = decideJudgedSources(sources.map((source, i) => ({ source, score: scores[i] })))
    const ms = Date.now() - startedAt

    // INFO and always, including when nothing was dropped. "The model looked
    // and kept everything" and "the model was never asked" are the two
    // outcomes an operator most needs to tell apart, and they are the same
    // silence without this line.
    logger.info(
      {
        title: subject.title,
        model: answer.model,
        documents: sources.length,
        answered: outcome.answered,
        dropped: outcome.dropped,
        droppedChars: outcome.dropped.reduce((sum, d) => sum + d.chars, 0),
        // True when the model condemned more than the floor allowed to go, which
        // is the signal that the retrieval was mostly noise rather than that the
        // filter is working well.
        floored: outcome.floored,
        ms,
      },
      outcome.dropped.length > 0
        ? `🧹 Dropped ${outcome.dropped.length}/${sources.length} documents the decision model ruled out`
        : `🧹 Decision model kept all ${sources.length} documents`
    )

    return { sources: outcome.kept, status: 'filtered', outcome, model: answer.model, ms }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(
      { err, title: subject.title },
      'Judging retrieved documents failed; keeping every document'
    )
    return { sources, status: 'failed', reason }
  }
}
