import { useContext } from 'react'
import { ConnectionsContext } from './connections-context'

export function useConnections() {
  const context = useContext(ConnectionsContext)
  if (!context) {
    throw new Error('useConnections must be used within a ConnectionsProvider')
  }
  return context
}
