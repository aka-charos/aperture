/**
 * Labelling live evidence: the queue of pairs the three judges disagree on,
 * and the operator's labels. The rules (grouping, order, scoring) are pure and
 * live in ./evidenceLabelling.ts; this file reads the stored verdicts and
 * writes labels.
 *
 * The verdicts come from the same rows the read-back panel counts (each
 * viewer's newest completed run, reserved-slot picks left out), the facts and
 * the credits rule from the same loader the model is handed, and the cosine
 * bar from hasCausalEvidence — so a label is scored against exactly what the
 * app decided, not a re-computation that could disagree with it.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { creditsRuleVerdict, type BenchmarkTally } from './evidenceBenchmarkPairs.js'
import {
  isEvidenceLabel,
  judgeGroup,
  labellingOrder,
  mergeViewerRows,
  pairKey,
  tallyLabelledPairs,
  type EvidenceLabel,
  type JudgeGroup,
  type LabellingMediaType,
  type LiveEvidenceRow,
} from './evidenceLabelling.js'
import { EVIDENCE_JUDGMENT_MIN_YES, hasCausalEvidence } from './evidenceStrength.js'
import type { JudgedTitleFacts } from './evidenceJudgment.js'
import { NEWEST_RUNS_SQL, RESERVED_SLOT_SQL, loadJudgedTitleFacts } from './judgeEvidence.js'

const logger = createChildLogger('evidence-labels')

export type LabellingFilter = 'toLabel' | 'modelAlone' | 'thresholdAlone' | 'ruleAlone' | 'labelled'

export const LABELLING_FILTERS: readonly LabellingFilter[] = [
  'toLabel',
  'modelAlone',
  'thresholdAlone',
  'ruleAlone',
  'labelled',
]

export function isLabellingFilter(value: unknown): value is LabellingFilter {
  return typeof value === 'string' && (LABELLING_FILTERS as readonly string[]).includes(value)
}

export interface LabellingItem {
  key: string
  mediaType: LabellingMediaType
  pickId: string
  pickTitle: string
  pickYear: number | null
  watchedId: string
  watchedTitle: string
  watchedYear: number | null
  viewers: number
  similarity: number | null
  thresholdSays: boolean | null
  ruleSays: boolean | null
  ruleBasis: 'director' | 'franchise' | null
  modelP: number | null
  modelSays: boolean | null
  group: JudgeGroup
  label: EvidenceLabel | null
}

export interface LabellingQueue {
  counts: Record<LabellingFilter | 'unanimous', number>
  labelled: number
  arguable: number
  tally: BenchmarkTally
  noSharedCreditsTally: BenchmarkTally
  /** How many items the filter holds, for paging. */
  total: number
  items: LabellingItem[]
}

interface StoredLabel {
  media_type: LabellingMediaType
  pick_id: string
  watched_id: string
  label: string
  labelled_at: Date
}

async function loadAllFacts(
  pairs: Array<{ mediaType: LabellingMediaType; pickId: string; watchedId: string }>
): Promise<Map<string, JudgedTitleFacts>> {
  const ids = { movie: new Set<string>(), series: new Set<string>() }
  for (const p of pairs) {
    ids[p.mediaType].add(p.pickId)
    ids[p.mediaType].add(p.watchedId)
  }
  const [movies, series] = await Promise.all([
    loadJudgedTitleFacts('movie', [...ids.movie]),
    loadJudgedTitleFacts('series', [...ids.series]),
  ])
  const out = new Map<string, JudgedTitleFacts>()
  for (const [id, facts] of movies) out.set(`movie:${id}`, facts)
  for (const [id, facts] of series) out.set(`series:${id}`, facts)
  return out
}

/**
 * Every judged pair on the newest runs with the three verdicts and any label,
 * then filtered and paged. Recomputed per request — a few thousand rows at
 * most, and the labels a person just gave must show at once.
 */
export async function getLabellingQueue(
  options: { filter?: LabellingFilter; offset?: number; limit?: number } = {}
): Promise<LabellingQueue> {
  const filter = options.filter ?? 'toLabel'
  const offset = Math.max(0, options.offset ?? 0)
  const limit = Math.min(100, Math.max(0, options.limit ?? 20))

  const rows = await query<{
    media_type: string
    pick_id: string
    watched_id: string
    similarity: number | string | null
    judged_connection: number | string | null
  }>(
    `WITH latest AS (${NEWEST_RUNS_SQL})
     SELECT l.media_type,
            COALESCE(rc.movie_id, rc.series_id) AS pick_id,
            COALESCE(re.similar_movie_id, re.similar_series_id) AS watched_id,
            re.similarity, re.judged_connection
     FROM latest l
     JOIN recommendation_candidates rc ON rc.run_id = l.id AND rc.is_selected = true
     JOIN recommendation_evidence re ON re.candidate_id = rc.id
     WHERE re.judged_connection IS NOT NULL
       AND NOT ${RESERVED_SLOT_SQL}`
  )

  const live: LiveEvidenceRow[] = []
  for (const r of rows.rows) {
    const mediaType = r.media_type === 'series' ? 'series' : r.media_type === 'movie' ? 'movie' : null
    if (!mediaType || !r.pick_id || !r.watched_id) continue
    live.push({
      mediaType,
      pickId: r.pick_id,
      watchedId: r.watched_id,
      similarity: r.similarity,
      judgedConnection: r.judged_connection,
    })
  }
  const pairs = mergeViewerRows(live)

  const [facts, labels] = await Promise.all([
    loadAllFacts(pairs),
    query<StoredLabel>(
      `SELECT media_type, pick_id, watched_id, label, labelled_at FROM evidence_labels`
    ),
  ])
  const labelByKey = new Map<string, { label: EvidenceLabel; at: number }>()
  for (const l of labels.rows) {
    if (!isEvidenceLabel(l.label)) continue
    labelByKey.set(pairKey(l.media_type, l.pick_id, l.watched_id), {
      label: l.label,
      at: new Date(l.labelled_at).getTime(),
    })
  }

  const items: LabellingItem[] = []
  for (const pair of pairs) {
    const pick = facts.get(`${pair.mediaType}:${pair.pickId}`)
    const watched = facts.get(`${pair.mediaType}:${pair.watchedId}`)
    if (!pick || !watched) continue
    const thresholdSays = pair.similarity == null ? null : hasCausalEvidence([pair.similarity])
    const modelSays = pair.modelP == null ? null : pair.modelP >= EVIDENCE_JUDGMENT_MIN_YES
    const rule = creditsRuleVerdict(pick, watched)
    const group =
      thresholdSays == null || modelSays == null
        ? 'unanimous'
        : judgeGroup(thresholdSays, rule.says, modelSays)
    items.push({
      key: pair.key,
      mediaType: pair.mediaType,
      pickId: pair.pickId,
      pickTitle: pick.title,
      pickYear: pick.year,
      watchedId: pair.watchedId,
      watchedTitle: watched.title,
      watchedYear: watched.year,
      viewers: pair.viewers,
      similarity: pair.similarity,
      thresholdSays,
      ruleSays: rule.says,
      ruleBasis: rule.basis,
      modelP: pair.modelP,
      modelSays,
      group,
      label: labelByKey.get(pair.key)?.label ?? null,
    })
  }

  const counts: LabellingQueue['counts'] = {
    toLabel: 0,
    modelAlone: 0,
    thresholdAlone: 0,
    ruleAlone: 0,
    labelled: 0,
    unanimous: 0,
  }
  for (const item of items) {
    if (item.group === 'unanimous') counts.unanimous++
    else {
      counts[item.group]++
      if (!item.label) counts.toLabel++
    }
    if (item.label) counts.labelled++
  }

  const selected = items.filter((item) => {
    switch (filter) {
      case 'toLabel':
        return item.group !== 'unanimous' && !item.label
      case 'labelled':
        return item.label != null
      default:
        return item.group === filter
    }
  })
  if (filter === 'labelled') {
    selected.sort((a, b) => (labelByKey.get(b.key)?.at ?? 0) - (labelByKey.get(a.key)?.at ?? 0))
  } else {
    selected.sort((a, b) => labellingOrder(a.key) - labellingOrder(b.key))
  }

  const tally = tallyLabelledPairs(items)
  return {
    counts,
    labelled: tally.labelled,
    arguable: tally.arguable,
    tally: tally.all,
    noSharedCreditsTally: tally.noSharedCredits,
    total: selected.length,
    items: selected.slice(offset, offset + limit),
  }
}

/** Record, change or (with null) remove a label. */
export async function setEvidenceLabel(input: {
  mediaType: LabellingMediaType
  pickId: string
  watchedId: string
  label: EvidenceLabel | null
  userId: string | null
}): Promise<void> {
  if (input.label === null) {
    await query(
      `DELETE FROM evidence_labels WHERE media_type = $1 AND pick_id = $2 AND watched_id = $3`,
      [input.mediaType, input.pickId, input.watchedId]
    )
    return
  }
  await query(
    `INSERT INTO evidence_labels (media_type, pick_id, watched_id, label, labelled_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (media_type, pick_id, watched_id)
     DO UPDATE SET label = EXCLUDED.label, labelled_by = EXCLUDED.labelled_by, labelled_at = NOW()`,
    [input.mediaType, input.pickId, input.watchedId, input.label, input.userId]
  )
  logger.debug({ ...input }, 'Evidence label recorded')
}

export interface StoredEvidenceLabel {
  mediaType: LabellingMediaType
  pickId: string
  watchedId: string
  label: EvidenceLabel
}

/** The newest labels, for the benchmark to re-ask. */
export async function listEvidenceLabels(limit: number): Promise<StoredEvidenceLabel[]> {
  const result = await query<StoredLabel>(
    `SELECT media_type, pick_id, watched_id, label, labelled_at
     FROM evidence_labels ORDER BY labelled_at DESC LIMIT $1`,
    [limit]
  )
  return result.rows
    .filter((r) => isEvidenceLabel(r.label) && (r.media_type === 'movie' || r.media_type === 'series'))
    .map((r) => ({
      mediaType: r.media_type,
      pickId: r.pick_id,
      watchedId: r.watched_id,
      label: r.label as EvidenceLabel,
    }))
}
