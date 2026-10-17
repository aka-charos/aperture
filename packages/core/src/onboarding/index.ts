/**
 * Onboarding: the welcome tour, the getting-started checklist and the
 * first-visit hints a person has seen. Rules in `rules.ts` (pure, pinned).
 */

export {
  MAX_IDS_PER_LIST,
  RATINGS_GOAL,
  buildChecklist,
  decideOnboardingMode,
  mergeOnboardingState,
  readOnboardingPatch,
  readOnboardingState,
  type Checklist,
  type ChecklistAvailability,
  type ChecklistFacts,
  type ChecklistItem,
  type ChecklistItemId,
  type OnboardingPatch,
  type OnboardingState,
  type WelcomeOutcome,
} from './rules.js'

export {
  getOnboardingState,
  getOnboardingSummary,
  updateOnboardingState,
  type OnboardingSummary,
} from './store.js'
