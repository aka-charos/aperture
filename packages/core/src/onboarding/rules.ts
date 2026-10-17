/**
 * Onboarding: the welcome tour, the getting-started checklist and the
 * first-visit hints. Pure, no DB — pinned by `rules.test.ts`.
 *
 * The web bundle owns the tour and hint ids (they name its own screens), so
 * the server keeps no copy of them: an id is accepted when it is shaped like
 * one, and arrays are capped so a client cannot grow a row without bound.
 * What the server DOES decide is everything the bundle must not hold a copy
 * of: whether the tour starts by itself, and which checklist items are done.
 */

/** A tour, hint or "seen" id: short kebab-case, like the bundle writes them. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
/** More than every tour and hint the app has, many times over. */
export const MAX_IDS_PER_LIST = 100

export type WelcomeOutcome = 'done' | 'dismissed'

export interface OnboardingState {
  /** How the welcome tour ended. Absent: it has not been shown to completion or dismissed. */
  welcome?: WelcomeOutcome
  /** Screen tours run to the end or skipped. */
  toursSeen?: string[]
  /** First-visit hints closed. */
  hintsDismissed?: string[]
  /** The getting-started card closed before every item was done. */
  checklistDismissed?: boolean
  /** Things only the browser can see happen (opening a pick's "why"). */
  seen?: string[]
}

/** A change to the stored state, as the client sends it. */
export interface OnboardingPatch {
  welcome?: WelcomeOutcome
  toursSeen?: string[]
  hintsDismissed?: string[]
  checklistDismissed?: boolean
  seen?: string[]
  /** Clear the tours and hints already seen, so they are offered again. */
  resetTips?: boolean
}

const LIST_KEYS = ['toursSeen', 'hintsDismissed', 'seen'] as const

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_IDS_PER_LIST) return null
  const out: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Read a patch from a request body, or say why it is refused. Refused rather
 * than trimmed: storing less than was asked for hands the client a state that
 * looks saved and is not.
 */
export function readOnboardingPatch(body: unknown): { patch: OnboardingPatch } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Expected an object' }
  const raw = body as Record<string, unknown>
  const patch: OnboardingPatch = {}

  for (const key of Object.keys(raw)) {
    if (!['welcome', 'checklistDismissed', 'resetTips', ...LIST_KEYS].includes(key)) {
      return { error: `Unknown field: ${key}` }
    }
  }

  if (raw.welcome !== undefined) {
    if (raw.welcome !== 'done' && raw.welcome !== 'dismissed') return { error: 'welcome must be "done" or "dismissed"' }
    patch.welcome = raw.welcome
  }
  if (raw.checklistDismissed !== undefined) {
    if (typeof raw.checklistDismissed !== 'boolean') return { error: 'checklistDismissed must be a boolean' }
    patch.checklistDismissed = raw.checklistDismissed
  }
  if (raw.resetTips !== undefined) {
    if (typeof raw.resetTips !== 'boolean') return { error: 'resetTips must be a boolean' }
    patch.resetTips = raw.resetTips
  }
  for (const key of LIST_KEYS) {
    if (raw[key] === undefined) continue
    const list = idList(raw[key])
    if (!list) return { error: `${key} must be a list of at most ${MAX_IDS_PER_LIST} short ids` }
    patch[key] = list
  }
  return { patch }
}

/**
 * Read stored state, dropping anything malformed rather than trusting it: the
 * column is JSONB and a bad value must cost that field, not the response.
 */
export function readOnboardingState(stored: unknown): OnboardingState {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const raw = stored as Record<string, unknown>
  const state: OnboardingState = {}
  if (raw.welcome === 'done' || raw.welcome === 'dismissed') state.welcome = raw.welcome
  if (raw.checklistDismissed === true) state.checklistDismissed = true
  for (const key of LIST_KEYS) {
    const list = idList(raw[key])
    if (list && list.length > 0) state[key] = list
  }
  return state
}

/**
 * Lists are UNIONED, never replaced: two tabs dismissing different hints must
 * both stick. A union past the cap keeps the newest ids, since an old one is
 * the least likely to be offered again.
 */
export function mergeOnboardingState(current: OnboardingState, patch: OnboardingPatch): OnboardingState {
  const next: OnboardingState = { ...current }
  if (patch.welcome) next.welcome = patch.welcome
  if (patch.checklistDismissed !== undefined) {
    if (patch.checklistDismissed) next.checklistDismissed = true
    else delete next.checklistDismissed
  }
  if (patch.resetTips) {
    delete next.toursSeen
    delete next.hintsDismissed
  }
  for (const key of LIST_KEYS) {
    const added = patch[key]
    if (!added || added.length === 0) continue
    const union = [...(next[key] ?? [])]
    for (const id of added) if (!union.includes(id)) union.push(id)
    next[key] = union.slice(-MAX_IDS_PER_LIST)
  }
  return next
}

/**
 * Whether the welcome tour starts by itself (`tour`), is offered once with a
 * small prompt (`offer`), or neither (`none`).
 *
 * `tour` only for an account whose first sign-in came after the tour shipped;
 * an older account is offered it and never forced. Anything recorded about
 * the welcome tour ends both. An unknown ship date reads as "everyone is
 * existing" — the safe side, since an offer can be ignored and a tour cannot.
 * An unknown first sign-in (the stamp failed, or a session from before the
 * column) reads as existing for the same reason.
 */
export function decideOnboardingMode(input: {
  firstLoginAt: Date | null
  introducedAt: Date | null
  state: OnboardingState
}): 'tour' | 'offer' | 'none' {
  if (input.state.welcome) return 'none'
  const { firstLoginAt, introducedAt } = input
  if (firstLoginAt && introducedAt && firstLoginAt.getTime() >= introducedAt.getTime()) return 'tour'
  return 'offer'
}

/** How many ratings make the "rate some titles" item done. */
export const RATINGS_GOAL = 5

export type ChecklistItemId = 'watch' | 'rate' | 'interest' | 'why' | 'assistant' | 'watching'

export interface ChecklistItem {
  id: ChecklistItemId
  done: boolean
  /** For a counted item: how far along, out of `goal`. */
  progress?: number
  goal?: number
}

/** What the checklist is decided from, all about the person's own record. */
export interface ChecklistFacts {
  playedTitles: number
  ratings: number
  interests: number
  conversations: number
  watchingSeries: number
  /** A completed recommendation run exists, for either media type. */
  hasRecommendations: boolean
  /** Whether a run is due to make one (the account gets recommendations at all). */
  receivesRecommendations: boolean
}

export interface ChecklistAvailability {
  assistant: boolean
  watching: boolean
}

export interface Checklist {
  items: ChecklistItem[]
  /** Every item done. */
  complete: boolean
  /** `ready`: picks exist; `pending`: one is coming; `off`: this account gets none. */
  recommendations: 'ready' | 'pending' | 'off'
}

/** The items this person can do, in the order they help most. */
export function buildChecklist(
  facts: ChecklistFacts,
  state: OnboardingState,
  available: ChecklistAvailability
): Checklist {
  const items: ChecklistItem[] = [
    { id: 'watch', done: facts.playedTitles > 0 },
    {
      id: 'rate',
      done: facts.ratings >= RATINGS_GOAL,
      progress: Math.min(facts.ratings, RATINGS_GOAL),
      goal: RATINGS_GOAL,
    },
    { id: 'interest', done: facts.interests > 0 },
    { id: 'why', done: state.seen?.includes('insights') === true },
  ]
  if (available.assistant) items.push({ id: 'assistant', done: facts.conversations > 0 })
  if (available.watching) items.push({ id: 'watching', done: facts.watchingSeries > 0 })

  return {
    items,
    complete: items.every((item) => item.done),
    recommendations: facts.hasRecommendations ? 'ready' : facts.receivesRecommendations ? 'pending' : 'off',
  }
}
