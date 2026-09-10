/**
 * Feed a stored analysis into the writers that explain WHY a title was picked.
 *
 * The analysis is title-scoped and the explanation is (user × title), and those
 * two must not be merged — but "must not be merged" was being read as "must not
 * touch", which threw away the only considered account of what a film is doing
 * that this system holds. Everything else a reason is written from is thin:
 * `overview` is marketing copy, keywords are tags, genres are a taxonomy. When
 * that is all there is, a model writing a reason falls back on what it happens
 * to remember — which is plentiful for canonical cinema and absent for the rest,
 * the exact bias the widened explanation prompt was meant to reduce.
 *
 * So the analysis arrives as MATERIAL, never as the subject:
 *
 * - Two segments only, `work` and `tradition` — what the film is doing and
 *   where it sits. Those are the two that connect to taste. `intent`,
 *   `circumstances` and `dispute` are about the making and the reception, which
 *   is an article's business and not a reason to watch something tonight.
 * - Each clipped hard, so a long analysis cannot crowd out the evidence titles
 *   that make the reason personal. That clip is the structural half of "not the
 *   subject"; the prompt rule is the other half.
 * - A row with NO usable paragraph map yields NOTHING. Without the map the
 *   article is one unlabelled block and there is no way to tell the tradition
 *   paragraph from the rest — so feeding it would mean feeding the one
 *   spoiler-shaped run blind. Absent beats guessing, and the row self-heals the
 *   next time ANALYSIS_PROMPT_VERSION moves.
 * - A declined row yields nothing, because there is nothing.
 *
 * Absent grounding leaves every prompt byte-identical to what it was, which is
 * what makes this safe to add to a paid batch: a title with no analysis is
 * explained exactly as well as it is today, and one with an analysis is
 * explained better. Nothing regresses.
 */
import { query } from '../lib/db.js'
import { clip } from '../recommender/shared/explanationPrompt.js'
import { buildAnalysisSegments } from './segments.js'
import type { ParagraphMap } from './paragraphMap.js'
import type { AnalysisQuestionId } from './prompt.js'

/**
 * The two questions worth grounding a recommendation in, in prompt order.
 *
 * Deliberately not all six. A reason is an argument about whether this viewer
 * will like this film; production circumstances and critical disputes are
 * context for someone already watching it.
 */
export const GROUNDING_QUESTIONS: readonly AnalysisQuestionId[] = ['work', 'tradition']

/**
 * Characters per segment.
 *
 * Sized against the budgets it sits beside — `PICK_PLOT_CHARS` is 600 and each
 * evidence title gets 220 — so the two together are comparable to the plot and
 * cannot outweigh the three watched titles the reason is supposed to connect
 * to. Raising this does not buy a better reason; it buys a summary.
 */
export const GROUNDING_SEGMENT_CHARS = 350

/** How the prompt names each grounded segment. */
const GROUNDING_LABELS: Record<string, string> = {
  work: 'What it is doing',
  tradition: 'Where it sits',
}

export interface AnalysisGroundingPart {
  question: AnalysisQuestionId
  text: string
}

/**
 * Pull the grounding segments out of one stored analysis.
 *
 * Pure — no DB, no formatting decisions — so the selection rules above can be
 * pinned without a database. Returns an empty array whenever there is nothing
 * usable, which every caller treats as "prompt unchanged".
 */
export function selectAnalysisGrounding(
  analysis: string | null,
  paragraphMap: ParagraphMap | null
): AnalysisGroundingPart[] {
  if (!analysis?.trim()) return []
  // No map means one unlabelled segment holding the whole article. That is a
  // valid stored row and an unusable grounding: see the module docstring.
  if (!paragraphMap) return []

  const segments = buildAnalysisSegments(analysis, paragraphMap)
  const parts: AnalysisGroundingPart[] = []

  for (const question of GROUNDING_QUESTIONS) {
    // A run can answer two questions at once — the model is told to merge what
    // belongs together — so the first run carrying this label is the one, and a
    // run labelled both `work` and `tradition` is used once per label rather
    // than twice over.
    const segment = segments.find((s) => s.questions.includes(question))
    if (!segment) continue
    const text = clip(segment.text, GROUNDING_SEGMENT_CHARS)
    if (text) parts.push({ question, text })
  }

  return parts
}

/**
 * Render grounding as prompt lines, or null when there is none.
 *
 * `indent` matches the caller's existing block so the lines sit with the plot
 * and themes rather than looking like a new section.
 */
export function formatAnalysisGrounding(
  parts: AnalysisGroundingPart[],
  indent = '   '
): string | null {
  if (parts.length === 0) return null
  return parts
    .map((part) => `\n${indent}${GROUNDING_LABELS[part.question] ?? part.question}: ${part.text}`)
    .join('')
}

/**
 * Load grounding for a batch of titles, keyed by media id.
 *
 * One query per batch, not one per title: the explanation generators already
 * work in batches of up to ten and a per-pick lookup would put ten round trips
 * inside each.
 *
 * Never throws. Grounding is an enhancement to prose that is already being
 * written and paid for, so a failure here must cost the batch its extra
 * material and nothing else.
 */
export async function loadAnalysisGrounding(
  mediaType: 'movie' | 'series',
  ids: string[]
): Promise<Map<string, AnalysisGroundingPart[]>> {
  const grounding = new Map<string, AnalysisGroundingPart[]>()
  if (ids.length === 0) return grounding

  try {
    const rows = await query<{
      media_id: string
      analysis: string | null
      paragraph_map: ParagraphMap | null
    }>(
      `SELECT media_id, analysis, paragraph_map
         FROM title_analysis
        WHERE media_type = $1 AND media_id = ANY($2::uuid[])
          AND analysis IS NOT NULL`,
      [mediaType, ids]
    )

    for (const row of rows.rows) {
      const parts = selectAnalysisGrounding(row.analysis, row.paragraph_map)
      if (parts.length > 0) grounding.set(row.media_id, parts)
    }
  } catch {
    // Swallowed on purpose — see the docstring.
  }

  return grounding
}
