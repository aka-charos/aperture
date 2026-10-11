/**
 * The saved AI key a settings action should use when the browser sent none.
 *
 * The role cards no longer receive keys (see `secretExposure.ts`), so Test,
 * model discovery and the LM Studio probe can no longer echo a key back; they
 * ask the server to use the saved one. This resolves it the way generation
 * does — the role's own key when the role is on that provider, otherwise the
 * provider's shared key (`withResolvedCredentials` in core) — and then applies
 * the one rule that makes a server-side lookup safe: the key goes only to an
 * address it was saved for, or a stolen admin session could aim a test at its
 * own server and read the key off the request.
 */
import {
  PROVIDERS,
  getFunctionConfig,
  resolveFallbackKeys,
  resolveProviderEndpoint,
  type AIFunction,
  type ProviderType,
} from '@aperture/core'
import { storedKeyMayGoTo } from './secretExposure.js'

async function storedContext(fn: AIFunction, provider: ProviderType) {
  const saved = await getFunctionConfig(fn)
  const own = saved?.provider === provider ? saved : null
  const shared = await resolveProviderEndpoint(provider)
  const defaultBaseUrl = PROVIDERS.find((p) => p.id === provider)?.defaultBaseUrl
  return {
    own,
    shared,
    allowedBaseUrls: [own?.baseUrl, shared.baseUrl, defaultBaseUrl],
  }
}

/**
 * The key and address a connection test should use: what the browser typed,
 * else what is saved. Shared by the settings and setup Test routes, which had
 * each written their own fallback.
 *
 * A request naming a spare-key slot tests that slot or nothing — reporting the
 * primary's success for a spare that is gone would be the worst answer, since a
 * spare is only ever needed once the primary has failed.
 */
export async function resolveTestCredentials(
  fn: AIFunction,
  provider: ProviderType,
  request: { apiKey?: string; baseUrl?: string; fallbackKeyIndex?: number }
): Promise<{ apiKey?: string; baseUrl?: string } | { error: string }> {
  const baseUrl = request.baseUrl || (await storedBaseUrlFor(fn, provider))
  if (request.apiKey) return { apiKey: request.apiKey, baseUrl }

  const index = request.fallbackKeyIndex
  if (index != null) {
    if (!Number.isInteger(index) || index < 0) return { error: 'Invalid spare key slot' }
    const key = await storedFallbackKeyFor(fn, provider, index, request.baseUrl)
    if (!key) return { error: 'That spare key is not saved on this role for this provider and address' }
    return { apiKey: key, baseUrl }
  }

  return { apiKey: await storedApiKeyFor(fn, provider, request.baseUrl), baseUrl }
}

/** The address a test should use when the browser sent none. */
export async function storedBaseUrlFor(fn: AIFunction, provider: ProviderType): Promise<string | undefined> {
  const { own, shared } = await storedContext(fn, provider)
  return own?.baseUrl || shared.baseUrl || undefined
}

/** The saved primary key for this role and provider, if it may go to `requestedBaseUrl`. */
export async function storedApiKeyFor(
  fn: AIFunction,
  provider: ProviderType,
  requestedBaseUrl: string | undefined
): Promise<string | undefined> {
  const { own, shared, allowedBaseUrls } = await storedContext(fn, provider)
  const key = own?.apiKey?.trim() || shared.apiKey?.trim()
  if (!key) return undefined
  return storedKeyMayGoTo(requestedBaseUrl, allowedBaseUrls) ? key : undefined
}

/**
 * The saved spare key at `index` on this role, if the role is on this provider
 * and the key may go to `requestedBaseUrl`. Spare keys live only on the role,
 * so there is no shared store to fall back to.
 */
export async function storedFallbackKeyFor(
  fn: AIFunction,
  provider: ProviderType,
  index: number,
  requestedBaseUrl: string | undefined
): Promise<string | undefined> {
  const { own, allowedBaseUrls } = await storedContext(fn, provider)
  if (!own) return undefined
  const key = resolveFallbackKeys(own)[index]
  if (!key) return undefined
  return storedKeyMayGoTo(requestedBaseUrl, allowedBaseUrls) ? key : undefined
}
