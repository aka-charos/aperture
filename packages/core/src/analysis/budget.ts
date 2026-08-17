/**
 * Fitting retrieved documents into the model's context.
 *
 * Self-hosted retrieval removed the per-day quota and replaced it with a
 * different hard limit: Google's grounding compressed the web server-side and
 * handed back a summary, whereas fastCRW hands back whole articles. Six pages
 * at 12,000 characters is 72,000 characters — around 18k tokens — which does not
 * fit a small local model and would be silently truncated at the wrong end by
 * the inference server if it did not fail outright.
 *
 * Pure and DB-free, same as `sourceFloor.ts` and `pending.ts`: an allocation
 * this easy to get subtly wrong should be testable without a database or a
 * model.
 */
import type { AnalysisSource } from './prompt.js'
import { MIN_SUBSTANTIVE_SOURCE_CHARS } from './sourceFloor.js'

/** Appended only when text was actually cut. */
const TRUNCATION_MARKER = '\n[… document truncated]'

export interface BudgetOptions {
  /** Total characters of source text the prompt may carry. */
  budget: number
  /**
   * Smallest slice worth including. Defaults to the floor's own definition of a
   * substantive source, and that agreement is the point: a slice thinner than
   * this would be counted as a real document by the floor while reading as a
   * fragment to the model.
   */
  minSlice?: number
}

/**
 * Cut at a word boundary where one is close by, so a slice never ends mid-word.
 *
 * `limit` bounds the RETURNED string, marker included — the budget is a hard
 * ceiling and appending the marker after slicing to the limit would overshoot
 * it once per truncated document. With a limit too small to hold the marker,
 * the text wins: an unmarked slice is better than a slice that is mostly marker.
 */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text

  const room = limit - TRUNCATION_MARKER.length
  if (room <= 0) return text.slice(0, limit)

  const cut = text.slice(0, room)
  const lastSpace = cut.lastIndexOf(' ')
  // Only honour the boundary if it is near the end; otherwise a document with no
  // spaces in its tail would lose most of its allocation.
  const body = lastSpace > room * 0.8 ? cut.slice(0, lastSpace) : cut
  return body.trimEnd() + TRUNCATION_MARKER
}

/**
 * Allocate the character budget across documents.
 *
 * Two properties matter and neither is what a naive "truncate everything to
 * budget/n" gives you:
 *
 * 1. SHORT DOCUMENTS ARE NEVER CUT. Allocation is water-filling — sorted
 *    ascending, each document takes the lesser of its own length and an even
 *    share of what is left, and the surplus from short ones flows to long ones.
 *    An even split would truncate a 700-character review to make room for text a
 *    30,000-character essay was never going to be allowed to use.
 *
 * 2. DOCUMENTS ARE DROPPED WHOLE RATHER THAN SHREDDED. Below `minSlice` a
 *    document is not a document, and eight fragments are worse input than three
 *    articles — they also lie to `decideAnalysisFloor`, which counts sources.
 *    Ranked order is preserved, so what gets dropped is what the search ranked
 *    last.
 *
 * Returns documents in their original (relevance) order.
 */
export function budgetSources(
  sources: AnalysisSource[],
  options: BudgetOptions
): AnalysisSource[] {
  const minSlice = options.minSlice ?? MIN_SUBSTANTIVE_SOURCE_CHARS
  const budget = Math.max(0, Math.trunc(options.budget))

  const usable = sources.filter((s) => s.text.trim().length > 0)
  if (usable.length === 0 || budget === 0) return []

  const total = usable.reduce((sum, s) => sum + s.text.length, 0)
  if (total <= budget) return usable

  // How many documents the budget can support at a usable size. At least one:
  // a single over-long document clipped to the budget is a fair answer, and if
  // the budget is so small that even that lands under minSlice, the floor will
  // decline the result — which is the correct outcome, reached honestly.
  const maxKeep = Math.max(1, Math.floor(budget / minSlice))
  const kept = usable.slice(0, maxKeep)

  // Water-filling. Ascending by length so every document short enough to fit
  // entirely is settled before the long ones divide what remains.
  const byLength = [...kept].sort((a, b) => a.text.length - b.text.length)
  const allocation = new Map<AnalysisSource, number>()
  let remaining = budget
  let unallocated = byLength.length

  for (const source of byLength) {
    const fairShare = Math.floor(remaining / unallocated)
    const take = Math.min(source.text.length, fairShare)
    allocation.set(source, take)
    remaining -= take
    unallocated--
  }

  return kept.map((source) => {
    const take = allocation.get(source) ?? 0
    return take >= source.text.length ? source : { ...source, text: clip(source.text, take) }
  })
}
