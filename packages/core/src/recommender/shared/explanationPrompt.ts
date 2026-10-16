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
import { formatEvidenceTags, type InterestEvidence } from './interestEvidence.js'

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
  /**
   * The genres/keywords on the title that say the interest
   * (shared/interestEvidence.ts). Absent on an interest pick means it was
   * chosen by embedding nearness to the phrase (runs from before evidence
   * existed, and the refresh found no tag either), so the prompt must not let
   * the model claim it IS what was asked for.
   */
  interestEvidence?: InterestEvidence | null
  fromTasteTwin?: boolean
  /**
   * Titles both viewers played, nearest to the pick first
   * (recommender/twinNearShared.ts). Titles from the READER's own history, so
   * naming them leaks nothing about the donor.
   *
   * These used to be the RAREST shared titles, with the instruction "that
   * shared ground is the reason this is in the list, so build the explanation
   * on it". Rarity proves two people match and says nothing about the pick, so
   * the model was ordered to find a thread through four arbitrary films and
   * wrote one ("Synecdoche, New York lives where those four meet"). The reason
   * a borrowed pick is here is the other viewer; these are offered as material
   * the model may use where the connection is concrete, never as a bridge it
   * must build.
   *
   * Absent when nothing was found or the run predates `sharedIds`; the bare
   * anonymous line is the fallback.
   */
  twinSharedTitles?: string[]
  /**
   * Where a twin pick ranked on its OWN score, before the twin slot placed it.
   * Without it the model only knows "the other viewer is the reason" and
   * writes the contrast as total — "rather than any pattern in your own
   * viewing" — about a film that scored a 90% taste match and came 26th
   * against a list of 20. See twinStandingLine.
   */
  ownStanding?: OwnStanding
  fromAcclaimed?: boolean
}

/**
 * A pick's own place in the run: `rank` among the `scored` titles that COULD
 * have been picked (favourites excluded at selection are not counted — they
 * never compete for a slot), against a final list of `listSize`.
 *
 * Built once, by the pipeline that scored the run (`ownStandingAt`), and
 * stored on the pick's `twinMatch` so the explanation writer, the refresh, the
 * explanation checker and the insights banner all read the same numbers
 * instead of each re-deriving them from columns that count different pools.
 */
export interface OwnStanding {
  rank: number
  scored: number
  listSize: number
}

/** Where a twin pick stood on its own score. */
export type TwinStandingBand = 'inside' | 'near' | 'strong' | 'far'

/**
 * How far outside the list counts as "nearly made it": within twice the list
 * size. Provisional and deliberately tight — saying a pick nearly made it when
 * it did not is the overclaim this exists to remove, in the other direction.
 */
export const TWIN_NEAR_MISS_FACTOR = 2

/** The top share of the scored pool that still counts as a strong match on its own. */
export const TWIN_STRONG_SHARE = 0.05

/**
 * The standing of the title at `index` in the run's selectable candidates,
 * sorted by finalScore. Undefined when the title is not among them, or any
 * count is unusable — never a guessed rank.
 */
export function ownStandingAt(index: number, scored: number, listSize: number): OwnStanding | undefined {
  const standing = { rank: index + 1, scored, listSize }
  return index >= 0 && isUsableStanding(standing) ? standing : undefined
}

function isUsableStanding(standing: OwnStanding): boolean {
  const { rank, scored, listSize } = standing
  return (
    [rank, scored, listSize].every((n) => Number.isInteger(n) && n > 0) && rank <= scored
  )
}

/**
 * Read a stored standing back off score_breakdown JSONB. Anything malformed is
 * undefined: the twin line then carries no standing, which is what it did
 * before standings existed.
 */
export function readOwnStanding(value: unknown): OwnStanding | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { rank, scored, listSize } = value as Record<string, unknown>
  if (typeof rank !== 'number' || typeof scored !== 'number' || typeof listSize !== 'number') {
    return undefined
  }
  const standing = { rank, scored, listSize }
  return isUsableStanding(standing) ? standing : undefined
}

/**
 * Which band a standing falls in. `inside` is its own band: a twin pick that
 * out-scored most of the list on its own and was passed over at selection
 * (diversity, or reserved slots taking the room) did not "nearly" make it.
 */
export function twinStandingBand(standing: OwnStanding | undefined): TwinStandingBand | null {
  if (!standing || !isUsableStanding(standing)) return null
  const { rank, scored, listSize } = standing
  if (rank <= listSize) return 'inside'
  if (rank <= listSize * TWIN_NEAR_MISS_FACTOR) return 'near'
  if (rank <= scored * TWIN_STRONG_SHARE) return 'strong'
  return 'far'
}

/**
 * The same standing as a plain fact, for the explanation checker's state —
 * the checker must be shown what the writer was shown (F-144 rule 1), but not
 * the writer's instructions. Null exactly when twinStandingLine is.
 */
export function describeStanding(standing: OwnStanding | undefined): string | null {
  const band = twinStandingBand(standing)
  if (!band || !standing) return null
  const reach = {
    inside: "inside the list's range, but passed over at selection",
    near: 'just outside the list — it nearly made it by itself',
    strong: 'well outside the list, though a strong match',
    far: 'far outside the list',
  }[band]
  return `On its own score it ranked #${standing.rank.toLocaleString('en-US')} of ${standing.scored.toLocaleString('en-US')} titles scored, against a list of ${standing.listSize.toLocaleString('en-US')}: ${reach}`
}

/**
 * The sentence that tells the model how close a twin pick came on its own,
 * with the numbers, so it can say so honestly. Null when the standing is
 * absent or malformed, which leaves the twin line as it was.
 *
 * Bands are decided here rather than by the model, which reads "#26 of
 * 12,451" as either far or close depending on the run. The numbers are for
 * the model's judgement; the prose may give the rank but never the pool size,
 * which is a fact about the library, not the viewer.
 */
export function twinStandingLine(standing: OwnStanding | undefined): string | null {
  const band = twinStandingBand(standing)
  if (!band || !standing) return null

  const format = (n: number) => n.toLocaleString('en-US')
  const place = `#${format(standing.rank)} of ${format(standing.scored)} titles scored, against a list of ${format(standing.listSize)}`
  const numbers = 'Never quote the number of titles scored to the reader'
  switch (band) {
    case 'inside':
      return `On its own score it ranked ${place} — inside the list's range by itself, but the selection passed it over; the other viewer's watching is what secured its place. Say that their own taste already rated it highly. ${numbers}`
    case 'near':
      return `On its own score it ranked ${place} — it nearly made the list by itself, and the other viewer's watching tipped it in. Say that; do not write as though their own taste had nothing to do with it. ${numbers}`
    case 'strong':
      return `On its own score it ranked ${place} — a strong match for them, but well outside the list; the other viewer's watching is what brought it in. ${numbers}`
    case 'far':
      return `On its own score it ranked ${place}, far outside the list — the other viewer's watching is essentially the whole reason. ${numbers}`
  }
}

/**
 * How many shared titles reach the prompt. They arrive nearest first, so the
 * tail is progressively less like the pick, and every entry costs prompt
 * budget on every pick.
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
    // Used to say only "lead with that", which instructed the model to assert
    // the match whatever it was; with nothing to check it against, it wrote
    // "this is a dark comedy" about whichever title the embedding offered.
    lines.push(
      slot.interestEvidence
        ? `\n   ✍️ THEY ASKED FOR THIS: they told us they like "${slot.interestText}", and this ${nouns.singular}'s own genres and keywords say so: ${formatEvidenceTags(slot.interestEvidence)}. Open with that, in their words, and claim no more about the match than those tags say`
        : `\n   ✍️ THEY ASKED FOR THIS: they told us they like "${slot.interestText}". This ${nouns.singular} was picked as one of the titles closest to that phrase, and nothing in its genres or keywords confirms it is one — say it is close to what they asked for, never that it is one`
    )
  }

  if (slot.fromTasteTwin) {
    const shared = (slot.twinSharedTitles ?? []).slice(0, TWIN_SHARED_TITLE_LIMIT)
    const standing = twinStandingLine(slot.ownStanding)
    lines.push(
      shared.length > 0
        ? `\n   👥 A KINDRED VIEWER PICKED THIS: someone here whose taste closely overlaps theirs watched it — that is why it is in the list, so lead with that.${standing ? ` ${standing}.` : ''} Of the titles the two of them have both watched, the closest to this ${nouns.singular} are: ${shared.join(', ')} (nearest first). Use one only where its connection to this ${nouns.singular} is concrete; never link them to each other or present them as a group with a shared thread. Never name or describe the other viewer`
        : `\n   👥 A KINDRED VIEWER PICKED THIS: another viewer here whose taste closely overlaps theirs watched it — lead with that, and never name or describe that person.${standing ? ` ${standing}` : ''}`
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
/**
 * Rules for the two analysis-derived lines, shared by both generators.
 *
 * Both halves are load-bearing and they pull against each other.
 *
 * The first stops the material becoming the subject. Handing a model critical
 * writing about a film and asking for a reason invites it to paraphrase the
 * criticism — an account of the work, identical for every reader, which is
 * exactly what a recommendation explanation is not. The clip in
 * `analysis/grounding.ts` is the structural half of that guard; this is the
 * instructional half, and neither is sufficient alone.
 *
 * The second is a spoiler guard placed at the moment of writing rather than
 * upstream. The analysis prompt already asks its own writer not to name a prior
 * work whose ending carries across, and that rule holds well — but it is an
 * instruction, so it will eventually fail on some title, and a reason on a card
 * for a film the viewer has NOT seen is a worse place for that failure to land
 * than an article they chose to open. A rule near the decision beats a rule far
 * from it, which is why this sits here and not only in the retrieval prompt.
 */
export function buildAnalysisRules(nouns: ExplanationNouns): string {
  return `- The "What it is doing" and "Where it sits" lines, when present, are critical writing about the ${nouns.singular}. Use them to name ONE specific quality and connect that quality to what this person watches. Do NOT summarize them, do NOT quote them, and never let them become the explanation — a reason that describes the ${nouns.singular} without reference to this viewer has failed
- From "Where it sits", name the tradition, movement or style. NEVER name one specific earlier ${nouns.singular} as this one's model: knowing how that one ends can give away how this one ends`
}

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

CRITICAL: A few recommendations are marked "THEY ASKED FOR THIS" with an interest the user typed in themselves. Open by connecting the ${nouns.singular} to that interest in the user's own words, using the tags the marker names as the evidence, and claim no more than they say; where the marker says nothing confirms the match, say the ${nouns.singular} is close to what they asked for, never that it is one. Never justify one of these on viewing-history similarity -- that is not why it is in the list -- and draw on the titles listed beneath it only if they genuinely fit: never say they "already love" a technique, mood or trick in another title unless the data you were given shows that title has it.

CRITICAL: A few recommendations are marked "A KINDRED VIEWER PICKED THIS". Those are in the list because another viewer with strongly overlapping taste watched them. Say that first. Where the marker says how the pick ranked on its own score, report that as given: one that nearly made the list by itself also matches this user's own taste, and the explanation must not claim otherwise. Where the marker names titles the two of them have both watched, those are the shared titles closest to this ${nouns.singular}: you may name one or two and say concretely what each shares with it, drawing on the data you were given, but never invent a thread running through them or claim the ${nouns.singular} sits "where they meet". The same goes for the titles listed beneath the recommendation: use them only if they genuinely fit. Refer to the other viewer only in general terms ("someone whose taste lines up with yours") -- you do not know who they are, so never name, guess at or describe them.

CRITICAL: A few recommendations are marked "WIDELY ACCLAIMED". Those are in the list because the ${nouns.singular} is very highly rated by a large number of viewers, which is a different reason from similarity to this user's history -- do not claim their viewing history led here. Say plainly that it is a landmark they have not seen yet, and use the titles listed beneath it only as secondary support if it genuinely fits.`
}
