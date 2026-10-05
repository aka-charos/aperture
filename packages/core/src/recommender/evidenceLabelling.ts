/**
 * The pure half of labelling live evidence: which pairs are worth a person's
 * judgement, in what order, and what the judgements say about the three
 * judges (similarity threshold, credits rule, decision model).
 *
 * WHY ONLY DISAGREEMENTS. The judges are compared with each other, and where
 * all three agree they are right or wrong together — a label there cannot move
 * one ahead of another. So a pair is offered only when they split, and with
 * three yes/no judges a split always has exactly one odd one out, which is how
 * the queue is grouped.
 *
 * WHY THE ORDER IS A HASH. Labels are given blind: the card hides every
 * verdict until the person has answered, because a percentage on screen is an
 * anchor. Ordering by group, by similarity or by the model's confidence would
 * leak the verdict through the position, so the default queue is ordered by a
 * hash of the pair — fixed, so a reload does not reshuffle it, and unrelated
 * to anything a judge said.
 *
 * WHY A PAIR, NOT A PICK. One recommendation carries up to three watched
 * titles, and each is its own claim ("X is why we picked Y"); a label answers
 * that claim. The same pair recurs across viewers who were shown the same
 * title for the same pick, so it is merged and labelled once.
 *
 * No runtime imports beyond other pure modules: pinned by
 * evidenceLabelling.test.ts without a database.
 */
import type { BenchmarkTally } from './evidenceBenchmarkPairs.js'

export const EVIDENCE_LABELS = ['yes', 'no', 'arguable'] as const
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number]

export function isEvidenceLabel(value: unknown): value is EvidenceLabel {
  return typeof value === 'string' && (EVIDENCE_LABELS as readonly string[]).includes(value)
}

export type LabellingMediaType = 'movie' | 'series'

export function isLabellingMediaType(value: unknown): value is LabellingMediaType {
  return value === 'movie' || value === 'series'
}

/** Which judge stands alone, or none when all three agree. */
export type JudgeGroup = 'modelAlone' | 'thresholdAlone' | 'ruleAlone' | 'unanimous'

export function judgeGroup(threshold: boolean, rule: boolean, model: boolean): JudgeGroup {
  if (threshold === rule && rule === model) return 'unanimous'
  if (threshold === rule) return 'modelAlone'
  if (model === rule) return 'thresholdAlone'
  return 'ruleAlone'
}

export function pairKey(mediaType: LabellingMediaType, pickId: string, watchedId: string): string {
  return `${mediaType}:${pickId}:${watchedId}`
}

/**
 * A stable position in the blind queue: 32-bit FNV-1a of the pair key. Fixed
 * per pair, and blind to every verdict.
 */
export function labellingOrder(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** One stored evidence row as the queue reads it. */
export interface LiveEvidenceRow {
  mediaType: LabellingMediaType
  pickId: string
  watchedId: string
  similarity: number | string | null
  judgedConnection: number | string | null
}

/** The same pair seen for several viewers, merged. */
export interface MergedEvidencePair {
  key: string
  mediaType: LabellingMediaType
  pickId: string
  watchedId: string
  /** How many viewers' recommendations offered this pair. */
  viewers: number
  similarity: number | null
  /** Mean P(yes) across the viewers' verdicts — one model, one pair, so they barely differ. */
  modelP: number | null
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

export function mergeViewerRows(rows: readonly LiveEvidenceRow[]): MergedEvidencePair[] {
  const merged = new Map<string, MergedEvidencePair & { pSum: number; pCount: number }>()
  for (const row of rows) {
    const key = pairKey(row.mediaType, row.pickId, row.watchedId)
    let pair = merged.get(key)
    if (!pair) {
      pair = {
        key,
        mediaType: row.mediaType,
        pickId: row.pickId,
        watchedId: row.watchedId,
        viewers: 0,
        similarity: null,
        modelP: null,
        pSum: 0,
        pCount: 0,
      }
      merged.set(key, pair)
    }
    pair.viewers++
    pair.similarity ??= toNumber(row.similarity)
    const p = toNumber(row.judgedConnection)
    if (p != null) {
      pair.pSum += p
      pair.pCount++
    }
  }
  return [...merged.values()].map(({ pSum, pCount, ...pair }) => ({
    ...pair,
    modelP: pCount > 0 ? pSum / pCount : null,
  }))
}

/** What the tally needs from a labelled pair: the label and each judge's call. */
export interface TalliedPair {
  label: EvidenceLabel | null
  thresholdSays: boolean | null
  ruleSays: boolean | null
  ruleBasis: 'director' | 'franchise' | null
  modelSays: boolean | null
}

export interface LabelTally {
  /** Pairs carrying any label. */
  labelled: number
  /** Of those, labelled arguable — shown, never scored. */
  arguable: number
  /** Scored on every labelled yes/no pair all three judges answered. */
  all: BenchmarkTally
  /** The same, on pairs sharing no director or franchise. */
  noSharedCredits: BenchmarkTally
}

const emptyTally = (): BenchmarkTally => ({ scored: 0, thresholdRight: 0, ruleRight: 0, modelRight: 0 })

/**
 * Score the judges on the person's labels. These pairs were chosen BECAUSE the
 * judges disagree on them, so the counts compare the judges with each other —
 * they are not accuracy rates, and the card says so.
 */
export function tallyLabelledPairs(pairs: readonly TalliedPair[]): LabelTally {
  const tally: LabelTally = {
    labelled: 0,
    arguable: 0,
    all: emptyTally(),
    noSharedCredits: emptyTally(),
  }
  for (const p of pairs) {
    if (!p.label) continue
    tally.labelled++
    if (p.label === 'arguable') {
      tally.arguable++
      continue
    }
    if (p.thresholdSays == null || p.ruleSays == null || p.modelSays == null) continue
    const truth = p.label === 'yes'
    const targets = p.ruleBasis == null ? [tally.all, tally.noSharedCredits] : [tally.all]
    for (const t of targets) {
      t.scored++
      if (p.thresholdSays === truth) t.thresholdRight++
      if (p.ruleSays === truth) t.ruleRight++
      if (p.modelSays === truth) t.modelRight++
    }
  }
  return tally
}
