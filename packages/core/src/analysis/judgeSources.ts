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
import {
  sanitizeDecisionModelConfig,
  type DecisionModelConfig,
} from '../lib/decisionModelRules.js'
import { getCrwConfig } from '../lib/crw.js'
import type { AnalysisSource, AnalysisSubject } from './prompt.js'
import {
  SOURCE_DROP_AT_OR_BELOW,
  SOURCE_FILTER_TEST_ARTICLE,
  SOURCE_FILTER_TEST_NOISE,
  SOURCE_FILTER_TEST_SUBJECT,
  buildSourceJudgmentRequest,
  decideJudgedSources,
  readSourceJudgments,
  sourceFilterTestFiller,
  type SourceJudgmentOutcome,
} from './sourceJudgment.js'

const logger = createChildLogger('analysis-sources')

export interface SourceFilterResult {
  /** What the prompt should carry. Identical to the input unless `status` is 'filtered'. */
  sources: AnalysisSource[]
  /**
   * off: the switch is off. unavailable: on, but it cannot be called.
   * nothing: too few documents for a drop to be possible. cancelled: Stop was
   * pressed before the call. filtered: asked and applied, which includes
   * asking and dropping none. failed: asked and the call did not answer.
   */
  status: 'off' | 'unavailable' | 'nothing' | 'cancelled' | 'filtered' | 'failed'
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
  sources: AnalysisSource[],
  options: { shouldCancel?: () => boolean | Promise<boolean> } = {}
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

    // CHECKED HERE, IMMEDIATELY BEFORE THE CALL. `analyseTitle` polls for a
    // Stop in the seam just after retrieval returns, whose own comment says
    // that is where a Stop pressed during the fetch should land - and this call
    // had been inserted in front of it, adding an uninterruptible wait of up to
    // `timeoutMs` to the very gap the seam exists to close. The scrape is the
    // minutes-long half, so a Stop pressed during it now skips the judging
    // instead of waiting it out.
    if (options.shouldCancel && (await options.shouldCancel()) === true) {
      return { sources, status: 'cancelled' }
    }

    const request = buildSourceJudgmentRequest(subject, sources)
    const startedAt = Date.now()
    const answer = await callSystemOne(
      resolved.endpoint,
      { model: config.model, state: request.state, questions: request.questions },
      config.timeoutMs,
      // A DEADLINE, so the worst case is ONE timeout rather than a timeout plus
      // a full-length retry. Mid-call abort is deliberately not plumbed:
      // `callSystemOne` builds its own `AbortSignal.timeout` and giving it a
      // cancellation signal means a poller per call, which is
      // `startStreamStallGuard`-shaped machinery for a twenty-second request.
      // Bounding the total is proportionate; the long half is above this line.
      startedAt + config.timeoutMs
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

// ============================================================================
// The connection test
// ============================================================================

/**
 * Try the source filter's own request before trusting it.
 *
 * THE HOLE THIS CLOSES. The card's Test ran `testEvidenceJudge` — three
 * questions over a tiny state — while this feature sends one question per
 * document over a sample each. Nothing exercised the second shape, so an
 * operator could tick the switch, pass the Test, and have every title fall
 * open forever with only a `warn` in the container log.
 *
 * IT IS SENT AT THE SIZE THE SETTINGS ALLOW, not at the size of two documents.
 * That is the whole point: a two-document probe answers "does it
 * discriminate" and says nothing about whether a real request fits the model's
 * context, which is the failure that actually bites (`maxResults` plus
 * `curatedMaxResults` reaches 40). So the two real documents go first, filler
 * pads the request out to the configured ceiling, and the result reports the
 * size and the verdicts separately — one call answering both questions.
 *
 * `answered` below the document count means the model returned a partial
 * answer, which a run would honour per document; here it is a warning sign
 * about the request rather than about any page.
 */
export type SourceFilterTestResult =
  | {
      success: true
      model: string
      latencyMs: number
      /** Documents sent, including filler — the ceiling the current settings allow. */
      documents: number
      /** How many came back with a readable verdict. */
      answered: number
      /** Characters of excerpt the request carried. */
      excerptChars: number
      /** P(worth reading) for the review; expected high. */
      article: number | null
      /** P(worth reading) for the podcast note; expected low. */
      noise: number | null
      /** Whether the two land on the right sides of the bar. */
      discriminates: boolean
    }
  | { success: false; error: string }

export async function testSourceFilter(
  input: Partial<DecisionModelConfig>
): Promise<SourceFilterTestResult> {
  // `enabled` is irrelevant to a test: the point is to try it before switching
  // it on — `testEvidenceJudge`'s rule.
  const config = sanitizeDecisionModelConfig({ ...input, enabled: true })
  const resolved = await resolveDecisionEndpoint(config)
  if (!resolved.ok) return { success: false, error: resolved.reason }

  let ceiling = 2
  try {
    const crw = await getCrwConfig()
    ceiling = Math.max(2, crw.maxResults + crw.curatedMaxResults)
  } catch {
    // An unreadable CRW config must not fail the probe; it only costs the
    // size half of the answer, and the default pair is what most instances run.
  }

  const sources: AnalysisSource[] = [SOURCE_FILTER_TEST_ARTICLE, SOURCE_FILTER_TEST_NOISE]
  for (let i = sources.length; i < ceiling; i++) sources.push(sourceFilterTestFiller(i))

  const request = buildSourceJudgmentRequest(SOURCE_FILTER_TEST_SUBJECT, sources)
  const excerptChars = Object.values(
    (request.state.documents ?? {}) as Record<string, { excerpt?: string }>
  ).reduce((sum, d) => sum + (d.excerpt?.length ?? 0), 0)

  const startedAt = Date.now()
  try {
    const answer = await callSystemOne(
      resolved.endpoint,
      { model: config.model, state: request.state, questions: request.questions },
      config.timeoutMs,
      startedAt + config.timeoutMs
    )
    const scores = readSourceJudgments(answer.answers, request.keys)
    const [article, noise] = scores
    return {
      success: true,
      model: answer.model,
      latencyMs: Date.now() - startedAt,
      documents: sources.length,
      answered: scores.filter((s) => s != null).length,
      excerptChars,
      article,
      noise,
      discriminates:
        article != null &&
        noise != null &&
        article > SOURCE_DROP_AT_OR_BELOW &&
        noise <= SOURCE_DROP_AT_OR_BELOW,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // The size is in the message on purpose: an oversized state answers 400,
    // and "HTTP 400" alone sends an operator to check their key.
    return {
      success: false,
      error: `${reason} (sent ${sources.length} documents, ${excerptChars.toLocaleString('en-US')} characters of excerpt)`,
    }
  }
}
