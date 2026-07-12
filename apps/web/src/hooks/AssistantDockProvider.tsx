import { useMemo, useState, type ReactNode } from 'react'
import { AssistantDockContext } from './assistant-dock-context'

/**
 * Shares the docked assistant's width between AssistantModal (which sets it)
 * and Layout (which reserves the space so the library stays fully visible).
 */
export function AssistantDockProvider({ children }: { children: ReactNode }) {
  const [dockWidth, setDockWidth] = useState(0)
  const [dockResizing, setDockResizing] = useState(false)
  const value = useMemo(
    () => ({ dockWidth, setDockWidth, dockResizing, setDockResizing }),
    [dockWidth, dockResizing]
  )

  return <AssistantDockContext.Provider value={value}>{children}</AssistantDockContext.Provider>
}
