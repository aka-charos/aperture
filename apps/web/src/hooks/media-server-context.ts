import { createContext } from 'react'

/**
 * Features that differ between Emby and Jellyfin.
 * Mirrors MediaServerCapabilities in packages/core/src/media/capabilities.ts, which is the
 * source of truth (core cannot be imported in the browser): keep the two in step.
 */
export interface MediaServerCapabilities {
  /** Home screen supports a configurable, filtered row (Emby "Dynamic Content"). */
  dynamicHomeRows: boolean
}

export type MediaServerKind = 'emby' | 'jellyfin'

export interface MediaServerContextValue {
  /** Configured server type, or null until loaded / when the request failed. */
  type: MediaServerKind | null
  isConfigured: boolean
  /**
   * Capabilities reported by the API, or null until they have loaded (or if the request
   * failed). There is deliberately no client-side default, so a flag cannot silently
   * disagree with the server: treat null as "unknown" and show nothing server-specific.
   */
  capabilities: MediaServerCapabilities | null
  loading: boolean
}

export const MediaServerContext = createContext<MediaServerContextValue | null>(null)
