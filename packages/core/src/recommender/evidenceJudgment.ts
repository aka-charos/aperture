/**
 * The pure half of judging recommendation evidence with a decision model.
 *
 * WHAT IS BEING JUDGED. `storeEvidence` keeps the three titles in a viewer's
 * history nearest a pick, with no distance floor, and `hasCausalEvidence`
 * decides whether they may be called the REASON for it from the best cosine
 * alone. evidenceStrength.ts measured why that cannot be right everywhere:
 * strong pairs sit at every level (Die Hard -> Live Free or Die Hard 0.680,
 * two Kieslowski films 0.672) and weak ones above them, so any single bar cuts
 * through both. A cosine says how near two vectors are; it cannot say WHY.
 *
 * A decision model is asked the "why" directly, once per evidence title: is
 * there a concrete connection — same director or creator, same franchise, a
 * shared subject, situation, tone or style — that makes enjoying the watched
 * title a fair reason to expect enjoying the pick? Broad genre, decade and
 * country do not count, which is exactly the band where the cosine bar fails.
 *
 * ONE REQUEST PER PICK, ONE QUESTION PER EVIDENCE TITLE. Questions in a System
 * One request are answered independently and share the state, so the pick is
 * described once and each watched title is a keyed entry beside it. Titles are
 * named inside each question as well as keyed, so a model that does not resolve
 * a path into the state still knows which two films it is comparing.
 *
 * ALL OR NOTHING PER PICK. A pick's verdict is used only when every one of its
 * evidence rows has one; a partial answer is discarded and the pick falls back
 * to the cosine bar. That keeps the read side a two-way choice instead of a
 * mixture nobody could explain.
 *
 * No runtime imports: pinned by evidenceJudgment.test.ts without a database.
 */
import { readNoul, type SystemOneQuestion } from '../lib/decisionModelRules.js'
import { EVIDENCE_JUDGMENT_MIN_YES, hasCausalEvidence } from './evidenceStrength.js'

export type JudgedMediaType = 'movie' | 'series'

/** What the model is shown about one title. Every field is library data. */
export interface JudgedTitleFacts {
  title: string
  year: number | null
  genres: string[]
  /** Directors for a film, creators for a series (the `directors` column). */
  creators: string[]
  /** TMDb collection name — the single strongest "same franchise" signal. */
  franchise?: string | null
  /** Series only. */
  network?: string | null
  /** TMDb keywords: where a style or subject is actually written down. */
  themes: string[]
  synopsis: string | null
}

/**
 * Synopsis length per title. Four titles per request, and the smallest hosted
 * model (Kev-4B) serves an 8k context, so the whole state stays far inside it.
 */
export const JUDGMENT_SYNOPSIS_CHARS = 500
export const JUDGMENT_THEME_LIMIT = 12
const JUDGMENT_CREATOR_LIMIT = 3

/** The question key for the evidence title at `index`: w1, w2, w3. */
export function judgmentKey(index: number): string {
  return `w${index + 1}`
}

function clipText(text: string | null | undefined, max: number): string | null {
  const value = text?.trim()
  if (!value) return null
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** The state entry for one title. Absent facts are left out, never invented. */
function describeTitle(facts: JudgedTitleFacts, mediaType: JudgedMediaType): Record<string, unknown> {
  const entry: Record<string, unknown> = { title: facts.title }
  if (facts.year != null) entry.year = facts.year
  if (facts.genres.length > 0) entry.genres = facts.genres
  const creators = facts.creators.filter(Boolean).slice(0, JUDGMENT_CREATOR_LIMIT)
  if (creators.length > 0) entry[mediaType === 'movie' ? 'directedBy' : 'createdBy'] = creators
  if (facts.franchise) entry.franchise = facts.franchise
  if (facts.network) entry.network = facts.network
  const themes = facts.themes.filter(Boolean).slice(0, JUDGMENT_THEME_LIMIT)
  if (themes.length > 0) entry.themes = themes
  const synopsis = clipText(facts.synopsis, JUDGMENT_SYNOPSIS_CHARS)
  if (synopsis) entry.synopsis = synopsis
  return entry
}

function label(facts: JudgedTitleFacts): string {
  return facts.year != null ? `"${facts.title}" (${facts.year})` : `"${facts.title}"`
}

export interface EvidenceJudgmentRequest {
  state: Record<string, unknown>
  questions: Record<string, SystemOneQuestion>
  /** keys[i] is the question for evidence[i]. */
  keys: string[]
}

/**
 * The state and questions for one pick and its evidence.
 *
 * The criteria spell out the boundary because it is subtle — TypeSafe's own
 * guidance for a `noul` — and the boundary is the whole point: a shared broad
 * genre is precisely what the cosine bar already admits and should not.
 */
export function buildEvidenceJudgmentRequest(
  pick: JudgedTitleFacts,
  evidence: JudgedTitleFacts[],
  mediaType: JudgedMediaType
): EvidenceJudgmentRequest {
  const noun = mediaType === 'movie' ? 'film' : 'series'
  const creatorWord = mediaType === 'movie' ? 'director' : 'creator'
  const watched: Record<string, unknown> = {}
  const questions: Record<string, SystemOneQuestion> = {}
  const keys: string[] = []

  evidence.forEach((item, index) => {
    const key = judgmentKey(index)
    keys.push(key)
    watched[key] = describeTitle(item, mediaType)
    questions[key] = {
      type: 'noul',
      instructions:
        `The viewer has watched ${label(item)} (watched.${key}). ` +
        `Is there a concrete, specific connection between ${label(pick)} (recommended) and ${label(item)} — ` +
        `the same ${creatorWord}, the same franchise, or a closely shared subject, story situation, tone or style — ` +
        `such that having watched ${label(item)} is a fair reason to expect they would enjoy ${label(pick)}? ` +
        `Use only the information in the state. Sharing only a broad genre, a decade, a country or popularity does not count.`,
      criteria: {
        true: `A specific shared element links the two ${noun === 'film' ? 'films' : 'series'}: the same ${creatorWord} or franchise, or a closely shared subject, situation, tone or style`,
        false: 'They share only broad traits such as genre, era, country or popularity, or nothing at all',
      },
    }
  })

  return {
    state: { mediaType: noun, recommended: describeTitle(pick, mediaType), watched },
    questions,
    keys,
  }
}

/**
 * The probability of "yes" for each key, in key order — or null when any one
 * is missing or malformed, so the pick falls back to the cosine bar whole.
 */
export function readEvidenceJudgments(answers: unknown, keys: readonly string[]): number[] | null {
  if (!answers || typeof answers !== 'object' || keys.length === 0) return null
  const map = answers as Record<string, unknown>
  const out: number[] = []
  for (const key of keys) {
    const value = readNoul(map[key])
    if (value == null) return null
    out.push(value)
  }
  return out
}

// ============================================================================
// Read-back: how often does the model disagree with the cosine bar?
// ============================================================================

export interface JudgedEvidenceRow {
  candidateId: string
  mediaType: string
  pickTitle: string
  evidenceTitle: string
  similarity: number | string | null
  judgedConnection: number | string | null
}

export interface JudgmentDisagreement {
  mediaType: string
  pickTitle: string
  /** The evidence title the model rated most connected, with its numbers. */
  evidenceTitle: string
  similarity: number | null
  judgedConnection: number | null
  /** What each side decided for the PICK as a whole. */
  judgeSupports: boolean
  cosineSupports: boolean
}

export interface EvidenceJudgmentSummary {
  /** Ranked picks on the newest completed runs. */
  picks: number
  /** Of those, how many carry a full set of verdicts. */
  judgedPicks: number
  /** Judged picks where the model and the cosine bar reach the same heading. */
  agree: number
  /** The model calls it a reason; the cosine bar would not. */
  judgeOnly: number
  /** The cosine bar calls it a reason; the model does not. */
  cosineOnly: number
  /** A sample of the disagreements, to read rather than to count. */
  examples: JudgmentDisagreement[]
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Group evidence rows by pick and compare the two decisions.
 *
 * The comparison is the point of showing this at all: a verdict that always
 * agrees with the cosine bar is buying nothing, and the examples are how an
 * operator finds out whether the model's disagreements are the right ones.
 */
export function summarizeEvidenceJudgments(
  rows: readonly JudgedEvidenceRow[],
  exampleLimit = 12
): EvidenceJudgmentSummary {
  const byPick = new Map<string, JudgedEvidenceRow[]>()
  for (const row of rows) {
    const list = byPick.get(row.candidateId)
    if (list) list.push(row)
    else byPick.set(row.candidateId, [row])
  }

  const summary: EvidenceJudgmentSummary = {
    picks: byPick.size,
    judgedPicks: 0,
    agree: 0,
    judgeOnly: 0,
    cosineOnly: 0,
    examples: [],
  }

  for (const pickRows of byPick.values()) {
    const verdicts = pickRows.map((r) => toNumber(r.judgedConnection))
    if (verdicts.length === 0 || verdicts.some((v) => v == null)) continue
    summary.judgedPicks++

    const judgeSupports = verdicts.some((v) => (v as number) >= EVIDENCE_JUDGMENT_MIN_YES)
    const cosineSupports = hasCausalEvidence(pickRows.map((r) => r.similarity))
    if (judgeSupports === cosineSupports) {
      summary.agree++
      continue
    }
    if (judgeSupports) summary.judgeOnly++
    else summary.cosineOnly++

    if (summary.examples.length < exampleLimit) {
      // The row that drove the model's answer: its most-connected title.
      let best = 0
      verdicts.forEach((v, i) => {
        if ((v as number) > (verdicts[best] as number)) best = i
      })
      const row = pickRows[best]
      summary.examples.push({
        mediaType: row.mediaType,
        pickTitle: row.pickTitle,
        evidenceTitle: row.evidenceTitle,
        similarity: toNumber(row.similarity),
        judgedConnection: verdicts[best],
        judgeSupports,
        cosineSupports,
      })
    }
  }

  return summary
}
