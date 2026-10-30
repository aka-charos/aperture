import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { WelcomeModal } from '@/components/WelcomeModal'
import { useWelcomeModal } from '@/components/useWelcomeModal'
import { useAuth } from './useAuth'
import { applyOnboardingPatch } from './onboardingState'
import {
  OnboardingContext,
  type OnboardingContextValue,
  type OnboardingPatch,
  type OnboardingSummary,
} from './onboarding-context'

/** A refresh asked for sooner than this after the last one is dropped. */
const REFRESH_MIN_INTERVAL_MS = 3000

/**
 * Session storage, holding the user id it was set for: the tour offer closed
 * with × stays away until this person signs in again, the way the old
 * welcome dialog's "next time I sign in" did. Another user signing in in the
 * same tab does not inherit it.
 */
const OFFER_SNOOZE_KEY = 'aperture-tour-offer-snoozed'

function readOfferSnooze(userId: string | null): boolean {
  if (!userId) return false
  try {
    return window.sessionStorage.getItem(OFFER_SNOOZE_KEY) === userId
  } catch {
    return false
  }
}

type State = OnboardingSummary['state']

/**
 * What the person has seen of the welcome tour, the screen tours and the
 * hints, and their getting-started checklist — fetched once per sign-in and
 * kept current as they record things.
 *
 * Also hosts the "How picks are made" explainer (the old welcome dialog),
 * which no longer opens by itself: the welcome tour and the Recommendations
 * page link to it.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, impersonation } = useAuth()
  const userId = user?.id ?? null
  const canSave = !impersonation
  const [summary, setSummary] = useState<OnboardingSummary | null>(null)
  const lastFetch = useRef(0)
  const [offerSnoozed, setOfferSnoozed] = useState(() => readOfferSnooze(userId))
  const [checklistShown, setChecklistShown] = useState(false)
  const { open: explainerOpen, showWelcome, hideWelcome } = useWelcomeModal()

  const load = useCallback(async () => {
    lastFetch.current = Date.now()
    try {
      const response = await fetch('/api/onboarding', { credentials: 'include' })
      if (!response.ok) return
      setSummary((await response.json()) as OnboardingSummary)
    } catch {
      // Onboarding is never worth an error on screen; without an answer
      // nothing starts by itself.
    }
  }, [])

  useEffect(() => {
    setSummary(null)
    setOfferSnoozed(readOfferSnooze(userId))
    if (userId) void load()
  }, [userId, load])

  const snoozeOffer = useCallback(() => {
    setOfferSnoozed(true)
    if (!userId) return
    try {
      window.sessionStorage.setItem(OFFER_SNOOZE_KEY, userId)
    } catch {
      // Without storage the offer simply comes back on the next load.
    }
  }, [userId])

  const refresh = useCallback(() => {
    if (Date.now() - lastFetch.current < REFRESH_MIN_INTERVAL_MS) return
    void load()
  }, [load])

  const record = useCallback(
    (patch: OnboardingPatch) => {
      setSummary((prev) => (prev ? { ...prev, state: applyOnboardingPatch(prev.state, patch), mode: patch.welcome ? 'none' : prev.mode } : prev))
      if (!canSave) return
      void fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
        .then(async (response) => {
          if (!response.ok) return
          const state = (await response.json()) as State
          setSummary((prev) => (prev ? { ...prev, state } : prev))
          // The checklist is decided by the server from this state, so a
          // "seen" it counts (reading why a title was picked) needs it asked
          // again — the card may be on screen under a title's dialog, and
          // would otherwise stay unticked until Home is opened again.
          if (patch.seen?.length) void load()
        })
        .catch(() => {})
    },
    [canSave, load]
  )

  const value = useMemo<OnboardingContextValue>(
    () => ({
      summary,
      record,
      refresh,
      showRecommenderExplainer: showWelcome,
      explainerOpen,
      canSave,
      offerSnoozed,
      snoozeOffer,
      checklistShown,
      setChecklistShown,
    }),
    [summary, record, refresh, showWelcome, explainerOpen, canSave, offerSnoozed, snoozeOffer, checklistShown]
  )

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <WelcomeModal open={explainerOpen} onClose={hideWelcome} />
    </OnboardingContext.Provider>
  )
}
