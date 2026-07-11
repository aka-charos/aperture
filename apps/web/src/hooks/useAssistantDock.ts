import { useContext } from 'react'
import { AssistantDockContext } from './assistant-dock-context'

export function useAssistantDock() {
  return useContext(AssistantDockContext)
}
