import { createContext } from 'react'

/** A person the viewer is connected to, as the server names them. */
export interface ConnectionSummary {
  id: string
  name: string
  avatarUrl: string
}

export interface ConnectionsContextValue {
  /**
   * The server's decided `social` capability: the viewer has at least one
   * visible connection. Everything social — the Shared entry, the
   * Recommend button, the history picker, the dashboard sliders — hangs off it.
   */
  enabled: boolean
  /** Visible connections, ordered by name. Empty until loaded, and when disabled. */
  connections: ConnectionSummary[]
  /** Titles waiting for the viewer under Shared — the sidebar badge. */
  pendingCount: number
  /**
   * Titles the viewer has sent that the Sent tab lists. With `pendingCount`,
   * decides whether the Shared entry is listed at all.
   */
  sentCount: number
  loading: boolean
  /**
   * `enabled && (loading || connections.length > 0)`: true from first paint for
   * someone with connections, so their controls do not flash in after a fetch.
   */
  hasConnections: boolean
  /** Refetch the connections and the badge; call after a send or a dismiss. */
  refresh: () => Promise<void>
}

export const ConnectionsContext = createContext<ConnectionsContextValue | null>(null)
