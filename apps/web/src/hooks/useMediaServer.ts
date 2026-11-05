/**
 * useMediaServer Hook
 *
 * Access the configured media server type and its capabilities.
 *
 *   const { capabilities } = useMediaServer()
 *   if (capabilities?.dynamicHomeRows) { ... }   // null until loaded
 *
 * Prefer checking a capability over comparing `type` to 'emby' / 'jellyfin'.
 */

import { useContext } from 'react'
import { MediaServerContext } from './media-server-context'

export { MediaServerProvider } from './MediaServerProvider'
export type {
  MediaServerCapabilities,
  MediaServerContextValue,
  MediaServerKind,
} from './media-server-context'

export function useMediaServer() {
  const context = useContext(MediaServerContext)
  if (!context) {
    throw new Error('useMediaServer must be used within a MediaServerProvider')
  }
  return context
}
