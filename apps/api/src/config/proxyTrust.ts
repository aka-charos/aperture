/**
 * Which upstream addresses may be believed when they forward a client IP.
 *
 * Fastify's `trustProxy` accepts a *function*, and consults it per request — so
 * despite the value being handed over at construction, the decision itself can
 * change on a live server. That is what makes this editable from the admin UI
 * with no restart. (An earlier reading of Fastify's source concluded otherwise;
 * `security.test.ts` now pins the dynamic behaviour so the mistake cannot come
 * back.)
 *
 * Matching is delegated to `proxy-addr`, the same library Fastify uses
 * internally, so CIDRs and IPv6 behave identically to the static form and there
 * is no second implementation to drift.
 *
 * Precedence: the TRUST_PROXY environment variable wins outright when set. An
 * operator who pinned this in a compose file should not have it silently
 * overridden from a web form, and it keeps the value available before any admin
 * account exists — which is the only way the first-run setup guard can be
 * protected behind a tunnel.
 */

import proxyaddr from 'proxy-addr'
import { getSystemSetting, setSystemSetting } from '@aperture/core'
import { createChildLogger } from '../lib/logger.js'
import { deploymentMode, trustProxy, LOOPBACK_PROXIES } from './security.js'

const logger = createChildLogger('proxy-trust')

export const TRUSTED_PROXIES_SETTING = 'trusted_proxies'

/** Compiled matcher for the current list; null means "trust nothing". */
let matcher: ((addr: string, hop: number) => boolean) | null = null
let current: string[] = []

/** True when TRUST_PROXY is set, which makes the stored value inert. */
export function proxyTrustIsEnvManaged(): boolean {
  return (process.env.TRUST_PROXY || '').trim().length > 0
}

/**
 * Reject anything proxy-addr cannot compile before it reaches the matcher.
 *
 * A bad entry would otherwise throw on every request rather than at save time,
 * taking the whole server down for a typo in a text box.
 */
export function validateProxyEntries(entries: string[]): string[] {
  const cleaned = entries.map((e) => e.trim()).filter(Boolean)
  for (const entry of cleaned) {
    try {
      proxyaddr.compile([entry])
    } catch {
      throw new Error(
        `"${entry}" is not a valid IP address, CIDR range, or preset (loopback, linklocal, uniquelocal)`
      )
    }
  }
  return cleaned
}

function compile(entries: string[]): void {
  current = entries
  if (entries.length === 0) {
    matcher = null
    return
  }
  try {
    matcher = proxyaddr.compile(entries)
  } catch (err) {
    // Should be unreachable: entries are validated on save. Failing closed
    // (trust nothing) is the safe direction — it degrades client IPs rather
    // than believing a forged header.
    logger.error({ err, entries }, 'Could not compile trusted proxies; trusting none')
    matcher = null
    current = []
  }
}

export interface ProxyTrustState {
  /** TRUST_PROXY is set, so the stored list is inert and the UI is read-only. */
  envManaged: boolean
  /** Addresses/CIDRs currently believed, for display and for the edit form. */
  entries: string[]
  /** TRUST_PROXY=true — any caller's X-Forwarded-For is believed. */
  trustsAll: boolean
  /** Whether anything at all is trusted; false means client IPs collapse. */
  trustsAny: boolean
}

/** The effective trust state, wherever it came from. */
export function getProxyTrustState(): ProxyTrustState {
  if (proxyTrustIsEnvManaged()) {
    const env = trustProxy()
    if (env === true) return { envManaged: true, entries: [], trustsAll: true, trustsAny: true }
    if (typeof env === 'number') {
      return { envManaged: true, entries: [`${env} hop(s)`], trustsAll: false, trustsAny: env > 0 }
    }
    const entries = Array.isArray(env) ? env : []
    return { envManaged: true, entries, trustsAll: false, trustsAny: entries.length > 0 }
  }
  return { envManaged: false, entries: current, trustsAll: false, trustsAny: current.length > 0 }
}

/**
 * Load the stored list into memory. Called at boot and after every save.
 *
 * Falls back to the DEPLOYMENT_MODE default when nothing is stored, so setting
 * the mode alone still does the right thing for a proxy on this host.
 */
export async function refreshProxyTrust(): Promise<void> {
  if (proxyTrustIsEnvManaged()) return

  let entries: string[] = []
  try {
    const stored = await getSystemSetting(TRUSTED_PROXIES_SETTING)
    if (stored !== null) {
      entries = stored.split(',').map((e) => e.trim()).filter(Boolean)
    } else if (deploymentMode() === 'proxy') {
      entries = [...LOOPBACK_PROXIES]
    }
  } catch (err) {
    logger.warn({ err }, 'Could not read trusted proxies; trusting none until next save')
  }

  compile(entries)
}

/** Persist a new list and apply it immediately. */
export async function setTrustedProxies(entries: string[]): Promise<string[]> {
  const cleaned = validateProxyEntries(entries)
  await setSystemSetting(
    TRUSTED_PROXIES_SETTING,
    cleaned.join(','),
    'Upstream addresses whose X-Forwarded-For header is believed'
  )
  compile(cleaned)
  logger.info({ trustedProxies: cleaned }, 'Trusted proxies updated')
  return cleaned
}

/**
 * The value handed to Fastify.
 *
 * Static when TRUST_PROXY is set (preserving hop counts and `true`, which a
 * function cannot express); otherwise a function, which is what allows the
 * admin UI to change it without a restart.
 */
export function buildTrustProxyOption(): boolean | number | string[] | ((addr: string, hop: number) => boolean) {
  if (proxyTrustIsEnvManaged()) return trustProxy()
  return (addr: string, hop: number) => (matcher ? matcher(addr, hop) : false)
}

/** Test seam. */
export function setTrustedProxiesForTest(entries: string[]): void {
  compile(entries)
}
