import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { WelcomeModal } from '@/components/WelcomeModal'
import { useWelcomeModal } from '@/components/useWelcomeModal'
import { useAuth } from './useAuth'
import {
  OnboardingContext,
  type OnboardingContextValue,
  type OnboardingPatch,
  type OnboardingSummary,
} from './onboarding-context'

/** A refresh asked for sooner than this after the last one is dropped. */
const REFRESH_MIN_INTERVAL_MS = 3000

type State = OnboardingSummary['state']
const LISTS = ['toursSeen', 'hintsDismissed', 'seen'] as const

/**
 * The same merge the server does (core onboarding/rules.ts), applied on screen
 * before the answer arrives, so a closed hint does not flicker back. The
 * server's answer replaces it when it lands.
 */
function applyPatch(state: State, patch: OnboardingPatch): State {
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
    next[key] = [...new Set([...(next[key] ?? []), ...added])]
  }
  return next
}

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
    if (userId) void load()
  }, [userId, load])

  const refresh = useCallback(() => {
    if (Date.now() - lastFetch.current < REFRESH_MIN_INTERVAL_MS) return
    void load()
  }, [load])

  const record = useCallback(
    (patch: OnboardingPatch) => {
      setSummary((prev) => (prev ? { ...prev, state: applyPatch(prev.state, patch), mode: patch.welcome ? 'none' : prev.mode } : prev))
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
        })
        .catch(() => {})
    },
    [canSave]
  )

  const value = useMemo<OnboardingContextValue>(
    () => ({ summary, record, refresh, showRecommenderExplainer: showWelcome, explainerOpen, canSave }),
    [summary, record, refresh, showWelcome, explainerOpen, canSave]
  )

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <WelcomeModal open={explainerOpen} onClose={hideWelcome} />
    </OnboardingContext.Provider>
  )
}
