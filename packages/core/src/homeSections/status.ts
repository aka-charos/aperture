/**
 * Can this instance's media server hold managed home sections, right now?
 *
 * Asked live every time — by each sync, by the settings page, and before the
 * feature may be switched on — because the answer is a property of the server,
 * which can be swapped or downgraded after the setting was saved.
 */

import { createMediaServerProvider } from '../media/index.js'
import type { MediaServerType } from '../media/types.js'
import { getMediaServerConfig } from '../settings/systemSettings.js'
import { MIN_EMBY_VERSION, isEmbyVersionSupported } from './version.js'

export type HomeSectionsSupportReason =
  | 'ok'
  | 'not-configured'
  | 'unsupported-provider'
  | 'unsupported-server'
  | 'unreachable'

export interface HomeSectionsServerStatus {
  providerType: MediaServerType | null
  serverVersion: string | null
  /** Shipped to the page as a decided value; the web bundle never holds it. */
  minVersion: string
  supported: boolean
  reason: HomeSectionsSupportReason
}

export async function getHomeSectionsServerStatus(): Promise<HomeSectionsServerStatus> {
  const config = await getMediaServerConfig()
  const base = { providerType: config.type ?? null, serverVersion: null, minVersion: MIN_EMBY_VERSION }

  if (!config.type || !config.baseUrl || !config.apiKey) {
    return { ...base, supported: false, reason: 'not-configured' }
  }
  if (config.type !== 'emby') {
    return { ...base, supported: false, reason: 'unsupported-provider' }
  }

  try {
    const provider = createMediaServerProvider(config.type, config.baseUrl)
    const info = await provider.getServerInfo(config.apiKey)
    const supported = isEmbyVersionSupported(info.version)
    return {
      ...base,
      serverVersion: info.version ?? null,
      supported,
      reason: supported ? 'ok' : 'unsupported-server',
    }
  } catch {
    return { ...base, supported: false, reason: 'unreachable' }
  }
}
