import { createContext } from 'react'

/** Features that differ between Emby and Jellyfin. Mirrors MediaServerCapabilities in @aperture/core. */
export interface MediaServerCapabilities {
  /** Home screen supports a configurable, filtered row (Emby "Dynamic Content"). */
  dynamicHomeRows: boolean
}

export type MediaServerKind = 'emby' | 'jellyfin'

export interface MediaServerContextValue {
  /** Configured server type, or null until loaded / when the request failed. */
  type: MediaServerKind | null
  isConfigured: boolean
  capabilities: MediaServerCapabilities
  loading: boolean
}

/**
 * Used until the server answers. Defaults to Emby-style behavior (matching the API's own
 * fallback) so nothing server-specific is hidden while loading.
 */
export const DEFAULT_MEDIA_SERVER_CAPABILITIES: MediaServerCapabilities = {
  dynamicHomeRows: true,
}

export const MediaServerContext = createContext<MediaServerContextValue | null>(null)
