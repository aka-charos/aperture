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

// ============================================================================
// Reserved-slot picks: saying why the pick is there, and not saying why it isn't
// ============================================================================

/**
 * The words that differ between the movie and series prompts. Everything below
 * is shared, because the two generators are near-duplicates and a rule present
 * in one and missing from the other is invisible until someone reads both.
 */
export interface ExplanationNouns {
  /** "movies" / "series" */
  plural: string
  /** "movie" / "show" */
  singular: string
}

export const MOVIE_NOUNS: ExplanationNouns = { plural: 'movies', singular: 'movie' }
export const SERIES_NOUNS: ExplanationNouns = { plural: 'series', singular: 'show' }

/**
 * Why a pick is in the list when the ranking is not the answer.
 *
 * All three markers mean the same structural thing: the diversity selector did
 * NOT choose this title, a reserved slot did. The similarity evidence is
 * therefore an account of what the pick resembles, never of why it is here.
 */
export interface SlotMarkers {
  interestText?: string | null
  fromTasteTwin?: boolean
  /**
   * The titles both viewers watched, rarest first -- the quantity twin affinity
   * is literally computed from (see recommender/twinAffinity.ts).
   *
   * This is the real reason a borrowed pick is in the list, and until now the
   * model was never given it: it received a bare "a kindred viewer picked this"
   * flag plus three unrelated nearest neighbours, and unsurprisingly wrote its
   * explanation out of the neighbours. These are titles from the READER's own
   * history, so naming them leaks nothing about the donor.
   *
   * Absent for runs made before this shipped and for twin matches predating
   * `sharedIds`; the bare anonymous line is the fallback.
   */
  twinSharedTitles?: string[]
  fromAcclaimed?: boolean
}

/**
 * How many shared titles reach the prompt. Four establishes real overlap; the
 * tail of that list is progressively less rare and so less evidential, and
 * every entry costs prompt budget on every pick.
 */
export const TWIN_SHARED_TITLE_LIMIT = 4

export function isReservedSlotPick(slot: SlotMarkers): boolean {
  return Boolean(slot.interestText || slot.fromTasteTwin || slot.fromAcclaimed)
}

/**
 * The two headings the evidence block can carry.
 *
 * Exported because the system prompt refers to them by name, and a rule naming
 * a heading the picks do not actually use is a rule that never fires.
 */
export const EVIDENCE_HEADING_RANKED = 'CLOSEST IN THEIR WATCH HISTORY'
export const EVIDENCE_HEADING_RESERVED = 'ALSO IN THEIR LIBRARY'

/**
 * Label the evidence block by what it can honestly claim.
 *
 * For a ranked pick, the three nearest titles in the viewer's history are a
 * fair account of why it scored where it did. For a reserved-slot pick they are
 * not -- the ranking is precisely what did not choose it -- and the insights
 * panel already says so in as many words. The prompt used to say the opposite,
 * which is how a Metropolis pick came to be explained by A Clockwork Orange and
 * Cloud Atlas directly underneath a caption stating those were not the reason.
 *
 * `evidenceIsClose` is the second way that account stops being fair, and it
 * applies to ranked picks too. storeEvidence keeps the three nearest watched
 * titles with NO distance floor, so a viewer whose history holds nothing near
 * the pick still gets three rows, and the model -- told to use this data and
 * invent nothing -- dutifully builds a reason out of them. Measured live, that
 * is how Das Boot at cosine 0.67 came to explain Metropolis. Decided by
 * hasCausalEvidence (recommender/evidenceStrength.ts), which owns the number.
 *
 * The argument is REQUIRED rather than defaulted, because a default is a
 * decision a caller can forget to make, and the two generators here are
 * near-duplicates that this module exists to stop drifting apart.
 *
 * Note the softened case reuses EVIDENCE_HEADING_RESERVED rather than adding a
 * third label: "context only, NOT why this was picked" is already exactly the
 * claim being made, and the prompt is easier for a model to follow with two
 * headings than with three.
 */
export function evidenceHeading(
  slot: SlotMarkers,
  nouns: ExplanationNouns,
  evidenceIsClose: boolean
): string {
  return isReservedSlotPick(slot) || !evidenceIsClose
    ? `   📍 ${EVIDENCE_HEADING_RESERVED} (context only — NOT why this ${nouns.singular} was picked):`
    : `   🎯 ${EVIDENCE_HEADING_RANKED} (nearest first):`
}

/** The marker lines telling the model which reserved slot a pick came from. */
export function buildSlotLines(slot: SlotMarkers, nouns: ExplanationNouns): string {
  const lines: string[] = []

  if (slot.interestText) {
    lines.push(
      `\n   ✍️ THEY ASKED FOR THIS: picked because they told us they like "${slot.interestText}" — lead with that`
    )
  }

  if (slot.fromTasteTwin) {
    const shared = (slot.twinSharedTitles ?? []).slice(0, TWIN_SHARED_TITLE_LIMIT)
    lines.push(
      shared.length > 0
        ? `\n   👥 A KINDRED VIEWER PICKED THIS: someone here whose taste closely overlaps theirs watched it. The two of them have both watched ${shared.join(', ')} — that shared ground is the reason this is in the list, so build the explanation on it. Never name or describe the other viewer`
        : `\n   👥 A KINDRED VIEWER PICKED THIS: another viewer here whose taste closely overlaps theirs watched it — lead with that, and never name or describe that person`
    )
  }

  if (slot.fromAcclaimed) {
    lines.push(
      `\n   🏆 WIDELY ACCLAIMED: in the list because of its standing, not because the ranking chose it — lead with what the ${nouns.singular} is and why it is held in that regard`
    )
  }

  return lines.join('')
}

/**
 * The bullets governing how the evidence block may be used.
 *
 * Replaces an unconditional `MUST: Reference the SPECIFIC watched movies listed
 * in "CLOSEST IN THEIR WATCH HISTORY"`, which applied to every pick including
 * the reserved-slot ones, and which the per-slot rules further down the prompt
 * then tried to walk back with weaker wording ("then use the similarity
 * evidence as support"). A model resolves that conflict toward the MUST, and
 * did.
 */
export function buildEvidenceRules(nouns: ExplanationNouns): string {
  return `- For a recommendation showing "${EVIDENCE_HEADING_RANKED}": reference those specific ${nouns.plural} and explain what qualities they share with the recommendation, drawing on the synopses, themes and crew you have been given
- For a recommendation showing "${EVIDENCE_HEADING_RESERVED}": that list is context, not cause. It tells you what the viewer already has; it is NOT a reason and must never be presented as one. Lead with the marked reason instead, and mention those titles only if they genuinely illuminate the pick`
}

/**
 * The three reserved-slot rules, in one place for both generators.
 *
 * Each now ends the same way -- the evidence may be used *only if it genuinely
 * fits*. Previously only the acclaimed rule was phrased that way; the interest
 * and twin rules said "then fill in with" and "then use as support", which are
 * instructions to use it rather than permission.
 */
export function buildSlotRules(nouns: ExplanationNouns): string {
  return `CRITICAL: Where a recommendation lists "${EVIDENCE_HEADING_RANKED}", those are the ${nouns.plural} it is genuinely closest to -- use that data and do not invent connections to random titles. Where it lists "${EVIDENCE_HEADING_RESERVED}" instead, the pick did NOT come from that similarity, and writing as though it did would be false.

CRITICAL: A few recommendations are marked "THEY ASKED FOR THIS" with an interest the user typed in themselves. Open by connecting the ${nouns.singular} to that interest in the user's own words. Never justify one of these on viewing-history similarity -- that is not why it is in the list -- and draw on the titles listed beneath it only if they genuinely fit.

CRITICAL: A few recommendations are marked "A KINDRED VIEWER PICKED THIS". Those are in the list because another viewer with strongly overlapping taste watched them, which is a different reason from similarity to this user's own history. Where the marker names titles the two of them have both watched, that shared ground IS the reason: name those titles and build the explanation on them, and draw on the titles listed beneath the recommendation only if they genuinely fit. Refer to the other viewer only in general terms ("someone whose taste lines up with yours") -- you do not know who they are, so never name, guess at or describe them.

CRITICAL: A few recommendations are marked "WIDELY ACCLAIMED". Those are in the list because the ${nouns.singular} is very highly rated by a large number of viewers, which is a different reason from similarity to this user's history -- do not claim their viewing history led here. Say plainly that it is a landmark they have not seen yet, and use the titles listed beneath it only as secondary support if it genuinely fits.`
}
