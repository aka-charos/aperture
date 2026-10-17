import { useContext } from 'react'
import { TourContext, type TourContextValue } from './tour-context'

const NO_TOUR: TourContextValue = {
  active: null,
  startTour: () => {},
  next: () => {},
  back: () => {},
  skip: () => {},
}

/** The running tour, and the controls to start and step one. Inert outside Layout. */
export function useTour(): TourContextValue {
  return useContext(TourContext) ?? NO_TOUR
}
