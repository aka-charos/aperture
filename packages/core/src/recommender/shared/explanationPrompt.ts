/**
 * What the explanation model is allowed to know, and how much of it.
 *
 * The generator supplied a title, a year, a genre list and 250 characters of
 * the pick's own synopsis, plus the *bare titles* of the three nearest things
 * in the viewer's history. Nothing else — no synopsis for those three, no
 * themes, no crew. So when it wrote that two films "are both Korean
 * masterpieces about the poor infiltrating the lives of the wealthy", every
 * word of that came from the model's own pretrained knowledge of two famous
 * films; the pipeline had supplied only the pairing. That is fine for canonical
 * cinema and silently disastrous for anything obscure, where the model has
 * nothing to recall and the instruction to be warm and exciting is the only
 * remaining pressure on what it writes.
 *
 * Kept in shared/ for the reason the parsing module is: the movie and series
 * generators are near-duplicates, and the numbers drifting apart between them
 * is a bug nobody would notice.
 */

/**
 * How much of a pick's own synopsis reaches the prompt.
 *
 * Raised from 250, which routinely cut off mid-sentence. Length is not the
 * constraint — the input side of these calls is cheap next to the output cap —
 * but dilution is, so this is not simply maximised: `overview` is the marketing
 * blurb, which characterises what a film *is*, and past a certain length there
 * is nothing left to add.
 *
 * `plot_full` (migration 0139) is deliberately NOT used here despite being much
 * longer and more specific. It is IMDb's user-submitted synopsis, which
 * routinely gives away the ending — the web UI hides it behind a "Read full
 * synopsis" button for exactly that reason — and the system prompt in both
 * generators instructs the model not to spoil. Handing it the spoilers and then
 * asking it not to spoil is a rule that only has to fail once, on a page the
 * viewer opened to decide whether to watch something.
 */
export const PICK_PLOT_CHARS = 600

/**
 * How much of an evidence title's synopsis reaches the prompt.
 *
 * Shorter than the pick's on purpose. Its job is to let the model say what the
 * two films actually share rather than assert a connection from the title
 * alone, and three of these ride along with every pick — at parity with
 * PICK_PLOT_CHARS the evidence would outweigh the film being explained.
 */
export const EVIDENCE_PLOT_CHARS = 220

/**
 * TMDb keywords carried per title.
 *
 * Worth more than their size: keywords are where a style is actually written
 * down. Almost no film noir has "noir" in its title or synopsis, and there is
 * no Film Noir genre — the same gap that forced a country filter onto the
 * assistant's search tools. Capped because the tail of a TMDb keyword list runs
 * to plot minutiae ("second-floor-apartment") that pull the model toward
 * trivia.
 */
export const KEYWORD_LIMIT = 10

/**
 * Truncate on a word boundary, with an ellipsis only when something was
 * actually removed.
 *
 * The generators used `substring(n) + '...'` unconditionally, so a two-sentence
 * synopsis was presented to the model as though it trailed off — and a model
 * shown a truncated-looking input has licence to fill in what came next, which
 * is the failure mode this whole module exists to reduce.
 */
export function clip(text: string | null | undefined, limit: number): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.length <= limit) return trimmed

  const cut = trimmed.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  // Only honour the word boundary if it isn't throwing away most of the budget
  // (a text with no spaces in `limit` characters is not prose).
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${body.replace(/[\s,;:]+$/, '')}…`
}
