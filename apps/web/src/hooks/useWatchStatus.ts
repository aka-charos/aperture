import { useContext } from 'react'
import { WatchStatusContext } from './watch-status-context'

export function useWatchStatus() {
  const context = useContext(WatchStatusContext)
  if (!context) {
    throw new Error('useWatchStatus must be used within a WatchStatusProvider')
  }
  return context
}
