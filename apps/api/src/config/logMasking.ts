/**
 * Redact deployment identity from the access logs so they can be shared.
 *
 * Every request line carries the public hostname the user reached the app on
 * plus the client's IP — fine in a private container log, not fine in a bug
 * report or a screenshot posted for help. This masks both at the point they are
 * logged, leaving the method/path/status/timing that make the log useful.
 *
 * Two controls, in precedence order (same shape as ./logging.ts):
 *   1. The `mask_log_urls` system setting — toggled from Settings > System.
 *   2. The `MASK_LOG_URLS` env var — the bootstrap default when unset.
 *
 * State is cached in memory and read synchronously per request (no DB hit);
 * refreshed at startup and whenever the setting is saved.
 */
import { getSystemSetting } from '@aperture/core'

/** System-setting key backing the Settings > System UI toggle. */
export const MASK_LOG_URLS_SETTING = 'mask_log_urls'

/** What masked values are replaced with — recognisable, obviously not real. */
const HOST_PLACEHOLDER = '[masked-host]'
const ADDRESS_PLACEHOLDER = '[masked-ip]'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

let enabled = TRUTHY.has((process.env.MASK_LOG_URLS ?? '').trim().toLowerCase())

/** Whether log masking is currently active (sync, cached). */
export function isLogMaskingEnabled(): boolean {
  return enabled
}

/**
 * Refresh the cached state. The `mask_log_urls` setting (UI toggle) takes
 * precedence; when unset, the MASK_LOG_URLS env var is the default. Fails open
 * to the env-derived value if the DB is unreachable.
 */
export async function refreshLogMaskingState(): Promise<void> {
  const fromEnv = TRUTHY.has((process.env.MASK_LOG_URLS ?? '').trim().toLowerCase())
  try {
    const dbVal = await getSystemSetting(MASK_LOG_URLS_SETTING)
    if (dbVal === 'true') {
      enabled = true
      return
    }
    if (dbVal === 'false') {
      enabled = false
      return
    }
    enabled = fromEnv
  } catch {
    enabled = fromEnv
  }
}

/** The `host` header for logging — masked when the setting is on. */
export function maskHost(host: string | undefined): string | undefined {
  if (!enabled) return host
  return host ? HOST_PLACEHOLDER : host
}

/** A client address for logging — masked when the setting is on. */
export function maskAddress(address: string | undefined): string | undefined {
  if (!enabled) return address
  return address ? ADDRESS_PLACEHOLDER : address
}

/**
 * Replace the host portion of a URL that would otherwise identify the
 * deployment (CORS origins, configured base URLs). Path and scheme survive so
 * the line still says what happened.
 */
export function maskUrl(url: string | undefined | null): string | undefined | null {
  if (!enabled || !url) return url
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]+/i, `$1${HOST_PLACEHOLDER}`)
}
