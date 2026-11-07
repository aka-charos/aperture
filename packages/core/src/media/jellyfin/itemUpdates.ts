/**
 * Jellyfin item update helpers — fetch/modify/post pattern required by the Jellyfin API.
 *
 * Jellyfin's `GET /Items/{id}` resolves the calling user from the request. An API key has
 * no user, so that call fails with an API key. The item has to be read through
 * `GET /Users/{userId}/Items/{id}` with an administrator's id instead; the update itself
 * is `POST /Items/{id}`, which needs no user.
 *
 * A user can only read what their account may see, so every enabled administrator is a
 * candidate: the first one that can read the item is used.
 */

import { logger, type JellyfinProviderBase } from './base.js'
import type { JellyfinUser } from './types.js'

const ADMIN_CACHE_TTL_MS = 10 * 60 * 1000

interface AdminCacheEntry {
  /** Enabled administrators, those with unrestricted library access first. */
  ids: string[]
  /** Last administrator that successfully read an item; tried first next time. */
  preferred?: string
  expiresAt: number
}

// Keyed by server URL and not by provider instance: callers build a fresh provider per operation.
// An API key sees the same administrators whichever key it is, so the key is not part of it.
const adminCache = new Map<string, AdminCacheEntry>()

/** Forget cached administrators (used by tests). */
export function clearAdminUserCache(): void {
  adminCache.clear()
}

async function getAdminCandidates(
  provider: JellyfinProviderBase,
  apiKey: string
): Promise<{ entry: AdminCacheEntry; fresh: boolean }> {
  const cached = adminCache.get(provider.baseUrl)
  if (cached && cached.expiresAt > Date.now()) return { entry: cached, fresh: false }

  const users = await provider.fetch<JellyfinUser[]>('/Users', apiKey)
  const admins = users.filter((u) => u.Policy.IsAdministrator && !u.Policy.IsDisabled)
  if (admins.length === 0) {
    throw new Error('No enabled administrator account found on the Jellyfin server')
  }

  // Unrestricted accounts see every library, so they are the most likely to read any item.
  const unrestricted = (u: JellyfinUser) =>
    u.Policy.EnableAllFolders !== false && u.Policy.MaxParentalRating == null
  const ids = [...admins.filter(unrestricted), ...admins.filter((u) => !unrestricted(u))].map(
    (u) => u.Id
  )

  const entry: AdminCacheEntry = { ids, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS }
  adminCache.set(provider.baseUrl, entry)
  return { entry, fresh: true }
}

async function readFromCandidates<T>(
  provider: JellyfinProviderBase,
  apiKey: string,
  itemId: string,
  entry: AdminCacheEntry
): Promise<T> {
  const order = entry.preferred
    ? [entry.preferred, ...entry.ids.filter((id) => id !== entry.preferred)]
    : entry.ids

  let lastError: unknown
  for (const userId of order) {
    try {
      const item = await provider.fetch<T>(`/Users/${userId}/Items/${itemId}`, apiKey)
      entry.preferred = userId
      return item
    } catch (err) {
      lastError = err
    }
  }

  throw lastError
}

/**
 * Read ONE item the way Jellyfin allows an API key to: `GET /Items/{id}` resolves the calling
 * user from the request and an API key has none, so the read goes through an enabled
 * administrator, the first who can see the item. Every by-id read in this provider uses it.
 *
 * If every cached administrator fails, the cached list may be stale (an account deleted,
 * disabled or demoted), so the list is read again once and the read retried only when it
 * changed. The user route returns the item with all its fields; there is no `Fields` filter.
 */
export async function readJellyfinItem<T = Record<string, unknown>>(
  provider: JellyfinProviderBase,
  apiKey: string,
  itemId: string
): Promise<T> {
  const { entry, fresh } = await getAdminCandidates(provider, apiKey)
  try {
    return await readFromCandidates<T>(provider, apiKey, itemId, entry)
  } catch (err) {
    if (fresh) throw err

    adminCache.delete(provider.baseUrl)
    const renewed = await getAdminCandidates(provider, apiKey)
    if (renewed.entry.ids.join() === entry.ids.join()) throw err
    return readFromCandidates<T>(provider, apiKey, itemId, renewed.entry)
  }
}

/**
 * Read an item, let `mutate` edit it, and post it back. If `mutate` returns `false`
 * the item is left alone and nothing is posted.
 */
export async function updateJellyfinItem(
  provider: JellyfinProviderBase,
  apiKey: string,
  itemId: string,
  mutate: (item: Record<string, unknown>) => void | boolean
): Promise<void> {
  const item = await readJellyfinItem(provider, apiKey, itemId)
  if (mutate(item) === false) return

  await provider.fetch(`/Items/${itemId}`, apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
}

/** Like updateJellyfinItem, but a failure is logged (with the error) and swallowed. */
export async function updateJellyfinItemSafely(
  provider: JellyfinProviderBase,
  apiKey: string,
  itemId: string,
  mutate: (item: Record<string, unknown>) => void | boolean,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await updateJellyfinItem(provider, apiKey, itemId, mutate)
  } catch (err) {
    logger.warn({ err, itemId, ...context }, 'Non-fatal Jellyfin item update failed')
  }
}
