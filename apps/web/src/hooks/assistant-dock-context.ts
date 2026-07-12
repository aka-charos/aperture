import { createContext } from 'react'

export interface AssistantDockContextType {
  /** Width in px the layout should reserve for the docked assistant (0 when closed or in modal mode). */
  dockWidth: number
  setDockWidth: (width: number) => void
  /** True while the user drags the dock's resize handle; Layout drops its width transitions so content tracks the pointer. */
  dockResizing: boolean
  setDockResizing: (resizing: boolean) => void
}

// Default is a no-op so consumers (Layout) work even outside the provider.
export const AssistantDockContext = createContext<AssistantDockContextType>({
  dockWidth: 0,
  setDockWidth: () => {},
  dockResizing: false,
  setDockResizing: () => {},
})
