/**
 * Media Server Type Detection
 *
 * The server type (Emby / Jellyfin) is chosen by the admin. This module asks the
 * server what it actually is, so a wrong choice can be flagged before features that
 * depend on the type are shown or hidden.
 *
 * It uses GET /System/Info/Public, which both servers expose without authentication.
 */

import type { MediaServerType } from './types.js'

export interface DetectedMediaServer {
  /** Detected type, or null when the response could not be classified. */
  type: MediaServerType | null
  /** What the classification was based on. */
  basis: 'productName' | 'version' | null
  productName: string | null
  version: string | null
  serverName: string | null
}

interface PublicSystemInfo {
  ProductName?: unknown
  Version?: unknown
  ServerName?: unknown
}

const DETECT_TIMEOUT_MS = 8000

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Classify a /System/Info/Public payload.
 *
 * 1. ProductName ("Jellyfin Server" on Jellyfin) when it names a server.
 * 2. Otherwise the major version: Emby releases are 4.x, Jellyfin releases are 10.x
 *    and above. Anything else is left unclassified rather than guessed.
 */
export function classifyMediaServer(info: PublicSystemInfo): DetectedMediaServer {
  const productName = asString(info.ProductName)
  const version = asString(info.Version)
  const serverName = asString(info.ServerName)
  const base = { productName, version, serverName }

  const product = productName?.toLowerCase() ?? ''
  if (product.includes('jellyfin')) return { ...base, type: 'jellyfin', basis: 'productName' }
  if (product.includes('emby')) return { ...base, type: 'emby', basis: 'productName' }

  const major = version ? Number.parseInt(version.split('.')[0], 10) : Number.NaN
  if (major === 4) return { ...base, type: 'emby', basis: 'version' }
  if (Number.isFinite(major) && major >= 10) return { ...base, type: 'jellyfin', basis: 'version' }

  return { ...base, type: null, basis: null }
}

/**
 * Ask the server at baseUrl which product it is.
 * Never throws: an unreachable server, a non-JSON reply or a timeout returns null.
 */
export async function detectMediaServerType(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<DetectedMediaServer | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}/System/Info/Public`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null

    const info = (await response.json()) as PublicSystemInfo | null
    if (!info || typeof info !== 'object') return null

    return classifyMediaServer(info)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
