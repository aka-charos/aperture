import type { OnboardingPatch, OnboardingSummary } from './onboarding-context'

/** Home, where the getting-started checklist is drawn. */
export const CHECKLIST_PATH = '/'

/** The checklist has something left to do and was not hidden: Home draws it. */
export function checklistPending(summary: OnboardingSummary | null): boolean {
  return Boolean(summary && !summary.checklist.complete && !summary.state.checklistDismissed)
}

/**
 * The checklist is on screen at this address. While it is, the tour offer is
 * one of its rows and does not float over the page as well (one thing at a
 * time). Derived from the same summary both components read, rather than
 * reported by the card once it has drawn: a report lands a frame late, and in
 * that frame the floating offer had already started sliding in.
 */
export function checklistOnScreen(summary: OnboardingSummary | null, pathname: string): boolean {
  return pathname === CHECKLIST_PATH && checklistPending(summary)
}

/**
 * The onboarding merge, applied on screen before the server answers so a
 * closed tip does not flicker back. A copy of core `onboarding/rules.ts`
 * `mergeOnboardingState` (the bundle never imports core), pinned against the
 * same cases by `onboardingState.test.ts`: lists are unioned, a union past
 * the cap keeps the newest ids, a reset clears tours and tips only. The
 * server's answer replaces this when it lands.
 */

/** Core's MAX_IDS_PER_LIST. */
export const MAX_IDS_PER_LIST = 100

type State = OnboardingSummary['state']
const LISTS = ['toursSeen', 'hintsDismissed', 'seen'] as const

export function applyOnboardingPatch(state: State, patch: OnboardingPatch): State {
  const next: State = { ...state }
  if (patch.welcome) next.welcome = patch.welcome
  if (patch.checklistDismissed !== undefined) {
    if (patch.checklistDismissed) next.checklistDismissed = true
    else delete next.checklistDismissed
  }
  if (patch.resetTips) {
    delete next.toursSeen
    delete next.hintsDismissed
  }
  for (const key of LISTS) {
    const added = patch[key]
    if (!added?.length) continue
    const union = [...(next[key] ?? [])]
    for (const id of added) if (!union.includes(id)) union.push(id)
    next[key] = union.slice(-MAX_IDS_PER_LIST)
  }
  return next
}
