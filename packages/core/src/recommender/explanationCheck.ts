/**
 * The pure half of checking written recommendation explanations with the
 * decision model: what it is shown, what it is asked, and how its answers and
 * the operator's labels are read.
 *
 * WHY THIS EXISTS. The evidence verdicts (./evidenceJudgment.ts) decide one
 * INPUT to the explanation — which heading the writer is given over the
 * watched titles. Nothing checked the OUTPUT, which is what a viewer reads: an
 * explanation can still claim a context-only title as the reason, assert a
 * link the data does not support, state facts it was never given (F-061's
 * no-invention rule exists because it does), or give the ending away.
 *
 * SAME FACTS AS THE WRITER. "Not in the data" only means something if the
 * checker sees the data the writer saw: the pick's synopsis, director or
 * creator, themes, analysis grounding and the reception label the prompt
 * printed, the watched titles, the heading over them, and — for a
 * reserved-slot pick — why it was picked. A fact the writer was handed and the
 * checker was not would be flagged as invented, which is a false alarm the
 * operator would rightly stop trusting.
 *
 * ALL FOUR QUESTIONS ARE PHRASED SO YES IS THE FAILURE, which is TypeSafe's
 * advice for a noul and keeps the reading uniform: any answer at or above the
 * model's own 0.5 is a flag.
 *
 * No runtime imports beyond node:crypto and other pure modules: pinned by
 * explanationCheck.test.ts without a database.
 */
import { createHash } from 'node:crypto'
import { readNoul, type SystemOneQuestion } from '../lib/decisionModelRules.js'
import { EVIDENCE_JUDGMENT_MIN_YES } from './evidenceStrength.js'
import type { JudgedTitleFacts } from './evidenceJudgment.js'

export const EXPLANATION_CHECKS = [
  'claimsContextAsReason',
  'unsupportedLink',
  'inventedFact',
  'spoiler',
] as const
export type ExplanationCheckId = (typeof EXPLANATION_CHECKS)[number]

/** The heading the writer was given over the watched titles. */
export type ExplanationHeading = 'reason' | 'contextOnly'

/** What put the pick in the list. Anything but `ranked` is a reserved slot. */
export type PickOrigin = 'ranked' | 'kindredViewer' | 'statedInterest' | 'acclaimed'

export interface ExplanationCheckInput {
  mediaType: 'movie' | 'series'
  explanation: string
  heading: ExplanationHeading
  origin: PickOrigin
  /** For a stated-interest pick: what the viewer said they like. */
  interestText?: string | null
  /** The reception label the writer's prompt printed, verbatim. */
  reception: string
  pick: JudgedTitleFacts
  /** The analysis grounding lines the writer saw, when it saw any. */
  analysis?: string | null
  watched: JudgedTitleFacts[]
}

/**
 * The key a check and a label are stored under: the explanation's own text.
 * A rewritten explanation is therefore a new item that is checked again, and
 * a label stays attached to the exact words that were judged.
 */
export function explanationHash(explanation: string): string {
  return createHash('sha256').update(explanation.trim()).digest('hex').slice(0, 40)
}

/** The writer's reception wording, per media type (the two prompts differ). */
export function receptionLabel(mediaType: 'movie' | 'series', ratingScore: number | null): string {
  const score = ratingScore ?? 0
  if (score > 0.7) return mediaType === 'movie' ? 'highly acclaimed' : 'critically acclaimed'
  if (score > 0.5) return 'well received'
  return 'mixed'
}

/** Which reserved slot, if any, the stored breakdown records — read as the refresh reads it. */
export function pickOrigin(breakdown: unknown): { origin: PickOrigin; interestText: string | null } {
  const b = (breakdown ?? {}) as {
    interestMatch?: { interestText?: unknown } | null
    twinMatch?: unknown
    acclaimedMatch?: unknown
  }
  if (b.interestMatch != null) {
    const text = b.interestMatch.interestText
    return { origin: 'statedInterest', interestText: typeof text === 'string' && text ? text : null }
  }
  if (b.twinMatch != null) return { origin: 'kindredViewer', interestText: null }
  if (b.acclaimedMatch != null) return { origin: 'acclaimed', interestText: null }
  return { origin: 'ranked', interestText: null }
}

const SYNOPSIS_CHARS = 1000
const WATCHED_SYNOPSIS_CHARS = 400

function clip(text: string | null | undefined, max: number): string | null {
  const value = text?.trim()
  if (!value) return null
  return value.length <= max ? value : `${value.slice(0, max).trimEnd()}…`
}

function describe(
  facts: JudgedTitleFacts,
  mediaType: 'movie' | 'series',
  synopsisChars: number
): Record<string, unknown> {
  const entry: Record<string, unknown> = { title: facts.title }
  if (facts.year != null) entry.year = facts.year
  if (facts.genres.length > 0) entry.genres = facts.genres
  const creators = facts.creators.filter(Boolean)
  if (creators.length > 0) entry[mediaType === 'movie' ? 'directedBy' : 'createdBy'] = creators
  if (facts.franchise) entry.franchise = facts.franchise
  if (facts.network) entry.network = facts.network
  if (facts.themes.length > 0) entry.themes = facts.themes.slice(0, 18)
  const synopsis = clip(facts.synopsis, synopsisChars)
  if (synopsis) entry.synopsis = synopsis
  return entry
}

const ORIGIN_TEXT: Record<PickOrigin, string> = {
  ranked: 'it ranked highly against the viewer’s taste',
  kindredViewer: 'another viewer whose taste closely overlaps theirs watched it',
  statedInterest: 'the viewer told us they like a particular kind of thing',
  acclaimed: 'it is widely acclaimed',
}

export interface ExplanationCheckRequest {
  state: Record<string, unknown>
  questions: Record<string, SystemOneQuestion>
  /** The checks asked, in order — the heading decides whether the first is. */
  checks: ExplanationCheckId[]
}

export function buildExplanationCheckRequest(input: ExplanationCheckInput): ExplanationCheckRequest {
  const noun = input.mediaType === 'movie' ? 'film' : 'series'
  const watched: Record<string, unknown> = {}
  input.watched.forEach((w, i) => {
    watched[`w${i + 1}`] = describe(w, input.mediaType, WATCHED_SYNOPSIS_CHARS)
  })

  const recommended: Record<string, unknown> = {
    ...describe(input.pick, input.mediaType, SYNOPSIS_CHARS),
    reception: input.reception,
  }
  const analysis = input.analysis?.trim()
  if (analysis) recommended.analysis = analysis

  const state: Record<string, unknown> = {
    mediaType: noun,
    recommended,
    pickedBecause:
      input.origin === 'statedInterest' && input.interestText
        ? `${ORIGIN_TEXT.statedInterest}: "${input.interestText}"`
        : ORIGIN_TEXT[input.origin],
    watchedTitlesShownAs:
      input.heading === 'reason'
        ? 'the reason for this recommendation'
        : 'context only — explicitly NOT the reason for this recommendation',
    watched,
    explanation: input.explanation.trim(),
  }

  const questions: Record<string, SystemOneQuestion> = {}
  const checks: ExplanationCheckId[] = []

  // Only a context-only heading makes this a fault; under a "reason" heading
  // presenting the watched titles as the reason is what the writer was asked.
  if (input.heading === 'contextOnly') {
    checks.push('claimsContextAsReason')
    questions.claimsContextAsReason = {
      type: 'noul',
      instructions:
        'The watched titles were shown to the viewer as context only, not as the reason for this recommendation. ' +
        'Does the explanation nonetheless present one of the watched titles as a reason the viewer would enjoy the recommended ' +
        `${noun}?`,
      criteria: {
        true: 'It says or implies the viewer will enjoy it because they watched one of the watched titles',
        false: 'It mentions the watched titles only as context, or not at all',
      },
    }
  }

  checks.push('unsupportedLink', 'inventedFact', 'spoiler')
  questions.unsupportedLink = {
    type: 'noul',
    instructions:
      `Does the explanation claim a connection between the recommended ${noun} and one of the watched titles that the information in the state does not support?`,
    criteria: {
      true: 'It asserts a shared creator, story, subject, theme, tone or style that nothing in the state shows',
      false: 'Every connection it draws is supported by the state, or it draws none',
    },
  }
  questions.inventedFact = {
    type: 'noul',
    instructions:
      `Does the explanation state a fact about the recommended ${noun} that is not in the state — people involved, awards, box office, critical reception, festival history, production history, or plot events? ` +
      'What it says about the viewer and their taste is not a fact about the title, and a description of genre, mood or subject that follows from the state is not invented.',
    criteria: {
      true: 'It states at least one fact about the title that the state does not contain',
      false: 'Everything it states about the title is in the state or follows directly from it',
    },
  }
  questions.spoiler = {
    type: 'noul',
    instructions: `Does the explanation reveal how the story ends, a major twist, or the fate of a main character of the recommended ${noun}?`,
    criteria: {
      true: 'It gives away an ending, a twist or a main character’s fate',
      false: 'It reveals nothing a viewer would not know before watching',
    },
  }

  return { state, questions, checks }
}

export type ExplanationCheckScores = Partial<Record<ExplanationCheckId, number>>

/** Each asked check's P(yes), or null when any answer is missing or malformed. */
export function readExplanationChecks(
  answers: unknown,
  checks: readonly ExplanationCheckId[]
): ExplanationCheckScores | null {
  if (!answers || typeof answers !== 'object' || checks.length === 0) return null
  const map = answers as Record<string, unknown>
  const out: ExplanationCheckScores = {}
  for (const id of checks) {
    const value = readNoul(map[id])
    if (value == null) return null
    out[id] = value
  }
  return out
}

/** The checks that failed: any asked check at or above the model's own boundary. */
export function explanationFailures(scores: ExplanationCheckScores): ExplanationCheckId[] {
  return EXPLANATION_CHECKS.filter((id) => {
    const p = scores[id]
    return p != null && p >= EVIDENCE_JUDGMENT_MIN_YES
  })
}

export const EXPLANATION_LABELS = ['accept', 'reject', 'unsure'] as const
export type ExplanationLabel = (typeof EXPLANATION_LABELS)[number]

export function isExplanationLabel(value: unknown): value is ExplanationLabel {
  return typeof value === 'string' && (EXPLANATION_LABELS as readonly string[]).includes(value)
}

export interface ExplanationAgreement {
  labelled: number
  unsure: number
  /** Accepted or rejected AND checked — the explanations the two can be compared on. */
  scored: number
  /** Jev flagged it and you rejected it. */
  flaggedRejected: number
  /** Jev flagged it and you accepted it — a false alarm. */
  flaggedAccepted: number
  /** Jev passed it and you rejected it — a miss. */
  passedRejected: number
  passedAccepted: number
}

/** How Jev's flags line up with the operator's accept/reject labels. */
export function tallyExplanationAgreement(
  items: ReadonlyArray<{ label: ExplanationLabel | null; flagged: boolean | null }>
): ExplanationAgreement {
  const tally: ExplanationAgreement = {
    labelled: 0,
    unsure: 0,
    scored: 0,
    flaggedRejected: 0,
    flaggedAccepted: 0,
    passedRejected: 0,
    passedAccepted: 0,
  }
  for (const item of items) {
    if (!item.label) continue
    tally.labelled++
    if (item.label === 'unsure') {
      tally.unsure++
      continue
    }
    if (item.flagged == null) continue
    tally.scored++
    if (item.flagged && item.label === 'reject') tally.flaggedRejected++
    else if (item.flagged) tally.flaggedAccepted++
    else if (item.label === 'reject') tally.passedRejected++
    else tally.passedAccepted++
  }
  return tally
}
