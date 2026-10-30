import { useContext } from 'react'
import { OnboardingContext, type OnboardingContextValue } from './onboarding-context'

const NO_ONBOARDING: OnboardingContextValue = {
  summary: null,
  record: () => {},
  refresh: () => {},
  showRecommenderExplainer: () => {},
  explainerOpen: false,
  canSave: false,
  offerSnoozed: false,
  snoozeOffer: () => {},
  checklistShown: false,
  setChecklistShown: () => {},
}

/** Onboarding state for the person signed in; inert outside Layout. */
export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext) ?? NO_ONBOARDING
}
