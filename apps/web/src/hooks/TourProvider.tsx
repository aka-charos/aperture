import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './useAuth'
import { useOnboarding } from './useOnboarding'
import { TourContext, type ActiveTour, type TourContextValue } from './tour-context'
import { TOURS, resolveSteps, type TourId } from '@/components/tour/tours'

/**
 * Which tour is running and on which step. The overlay that draws it is
 * `TourOverlay`, rendered by the app shell inside the help drawer's provider
 * so a step's "Read more" can open the guide.
 *
 * How a tour ended is recorded once: the welcome tour as `done` or
 * `dismissed`, a screen tour in `toursSeen` either way (it is offered again
 * from the ? drawer whenever someone asks).
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { capabilities } = useAuth()
  const { summary, record } = useOnboarding()
  const [active, setActive] = useState<ActiveTour | null>(null)

  const finish = useCallback(
    (tour: ActiveTour, completed: boolean) => {
      setActive(null)
      if (tour.id === 'welcome') record({ welcome: completed ? 'done' : 'dismissed' })
      else record({ toursSeen: [tour.id] })
    },
    [record]
  )

  const startTour = useCallback(
    (id: TourId) => {
      const steps = resolveSteps(TOURS[id], {
        capabilities,
        features: { watching: summary?.watchingEnabled === true },
      })
      if (steps.length === 0) return
      setActive({ id, steps, index: 0 })
    },
    [capabilities, summary?.watchingEnabled]
  )

  // Read from the closure, not inside a state updater: React may call an
  // updater twice, and recording how a tour ended must happen once.
  const next = useCallback(() => {
    if (!active) return
    if (active.index < active.steps.length - 1) setActive({ ...active, index: active.index + 1 })
    else finish(active, true)
  }, [active, finish])

  const back = useCallback(() => {
    if (active && active.index > 0) setActive({ ...active, index: active.index - 1 })
  }, [active])

  const skip = useCallback(() => {
    if (active) finish(active, false)
  }, [active, finish])

  const value = useMemo<TourContextValue>(
    () => ({ active, startTour, next, back, skip }),
    [active, startTour, next, back, skip]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}
