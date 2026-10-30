import { createContext } from 'react'

/** What `/api/onboarding` answers. Every decision in it is the server's. */
export interface OnboardingSummary {
  mode: 'tour' | 'offer' | 'none'
  state: {
    welcome?: 'done' | 'dismissed'
    toursSeen?: string[]
    hintsDismissed?: string[]
    checklistDismissed?: boolean
    seen?: string[]
  }
  watchingEnabled: boolean
  checklist: {
    complete: boolean
    recommendations: 'ready' | 'pending' | 'off'
    items: { id: string; done: boolean; progress?: number; goal?: number }[]
  }
}

export interface OnboardingPatch {
  welcome?: 'done' | 'dismissed'
  toursSeen?: string[]
  hintsDismissed?: string[]
  checklistDismissed?: boolean
  seen?: string[]
  resetTips?: boolean
}

export interface OnboardingContextValue {
  /** Null until the first answer, and stays null if the server cannot give one. */
  summary: OnboardingSummary | null
  /**
   * Record something. Applied on screen at once; sent to the server unless
   * this is an assumed session, which writes nothing.
   */
  record: (patch: OnboardingPatch) => void
  /** Ask again (after a rating, a new interest…), at most once a few seconds. */
  refresh: () => void
  /** Open the "How picks are made" explainer (the old welcome dialog). */
  showRecommenderExplainer: () => void
  /** The explainer is showing (a tour steps aside while it is). */
  explainerOpen: boolean
  /** False in an assumed session: what is shown there is not saved. */
  canSave: boolean
  /** The tour offer was closed with × in this sign-in: it is not answered, only put off. */
  offerSnoozed: boolean
  snoozeOffer: () => void
  /**
   * The getting-started checklist is on screen. While it is, the tour offer is
   * one of its rows instead of a card floating over the page: one thing at a time.
   */
  checklistShown: boolean
  setChecklistShown: (shown: boolean) => void
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null)
