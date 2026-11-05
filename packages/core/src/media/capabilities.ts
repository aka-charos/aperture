/**
 * Media Server Capabilities
 *
 * Single place that records where Emby and Jellyfin genuinely differ in what
 * they can do, so callers check a capability instead of comparing the server
 * type string. Only add a flag here for a real, verified server difference —
 * bugs in Aperture's own provider code should be fixed, not hidden behind a flag.
 */

import type { MediaServerType } from './types.js'

export interface MediaServerCapabilities {
  /**
   * The server's Home screen can host a configurable, filtered row
   * ("Dynamic Content": pick libraries, sort, play state, favorites).
   * Emby: yes. Jellyfin: no — its Home screen only offers a fixed list of
   * section types (library tiles, Continue Watching, Next Up, Latest Media, ...).
   */
  dynamicHomeRows: boolean
}

const CAPABILITIES: Record<MediaServerType, MediaServerCapabilities> = {
  emby: {
    dynamicHomeRows: true,
  },
  jellyfin: {
    dynamicHomeRows: false,
  },
}

/**
 * Capabilities for a server type. An unknown or unset type is treated as Emby,
 * matching the fallback used by the media-server settings endpoint.
 */
export function getMediaServerCapabilities(
  type: MediaServerType | string | null | undefined
): MediaServerCapabilities {
  return type === 'jellyfin' ? CAPABILITIES.jellyfin : CAPABILITIES.emby
}
