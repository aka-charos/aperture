import { createContext } from 'react'
import type { TourId, TourStep } from './tours'

export interface ActiveTour {
  id: TourId
  steps: TourStep[]
  index: number
}

export interface TourContextValue {
  active: ActiveTour | null
  /** Start a tour from its first step; a running one is replaced. */
  startTour: (id: TourId) => void
  next: () => void
  back: () => void
  /** End the tour before its last step. */
  skip: () => void
}

export const TourContext = createContext<TourContextValue | null>(null)
