/**
 * Media server helper functions for generating play links
 */
import { getMediaServerConfig, createMediaServerProvider, getSystemSetting } from '@aperture/core'
import type { MediaServerInfo } from '../types.js'

/**
 * Get media server configuration for generating play links
 */
export async function getMediaServerInfo(): Promise<MediaServerInfo | null> {
  try {
    const config = await getMediaServerConfig()
    if (!config.baseUrl || !config.apiKey || !config.type) return null

    let serverId = ''
    let reportedName = ''
    try {
      const provider = createMediaServerProvider(config.type, config.baseUrl)
      if ('getServerInfo' in provider) {
        const info = await (
          provider as { getServerInfo: (key: string) => Promise<{ id: string; name: string }> }
        ).getServerInfo(config.apiKey)
        serverId = info.id
        reportedName = info.name
      }
    } catch {
      // Server ID/name are optional for link generation
    }

    // Same precedence the rest of the app uses: operator override wins over the
    // name the server reports (see GET /api/settings/media-server).
    const customName = ((await getSystemSetting('server_display_name')) ?? '').trim()

    return {
      // Play links are user-facing: prefer the public URL when configured
      baseUrl: config.publicUrl || config.baseUrl,
      type: config.type as 'emby' | 'jellyfin',
      serverId,
      name: customName || reportedName || null,
    }
  } catch {
    return null
  }
}

/**
 * Build a play link for content on the media server.
 *
 * The `aperturePlay=1` query param marks the URL as a play link so the
 * frontend can render it as a play button without sniffing the link text
 * (which breaks in non-English locales). It sits before the hash, so the
 * media server just serves index.html and the SPA routes on the hash as usual.
 */
export function buildPlayLink(
  mediaServer: MediaServerInfo | null,
  providerItemId: string | null | undefined,
  _type: 'movie' | 'series'
): string | null {
  if (!mediaServer?.baseUrl || !providerItemId) return null

  const serverIdParam = mediaServer.serverId ? `&serverId=${mediaServer.serverId}` : ''
  const itemPath =
    mediaServer.type === 'jellyfin'
      ? `#!/details?id=${providerItemId}${serverIdParam}`
      : `#!/item?id=${providerItemId}${serverIdParam}`

  return `${mediaServer.baseUrl}/web/index.html?aperturePlay=1${itemPath}`
}
