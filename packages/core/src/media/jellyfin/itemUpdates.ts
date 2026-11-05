/**
 * Jellyfin item update helpers — fetch/modify/post pattern required by the Jellyfin API.
 *
 * Jellyfin's `GET /Items/{id}` resolves the calling user from the request. An API key has
 * no user, so that call fails with an API key. The item has to be read through
 * `GET /Users/{userId}/Items/{id}` with an administrator's id instead; the update itself
 * is `POST /Items/{id}`, which needs no user.
 */

import { getUsers } from './users.js'
import { logger, type JellyfinProviderBase } from './base.js'

const adminUserIds = new WeakMap<JellyfinProviderBase, string>()

/**
 * Id of an enabled administrator account, used as the user context for reading items.
 * Cached for the lifetime of the provider instance.
 */
export async function resolveAdminUserId(
  provider: JellyfinProviderBase,
  apiKey: string
): Promise<string> {
  const cached = adminUserIds.get(provider)
  if (cached) return cached

  const users = await getUsers(provider, apiKey)
  const admin = users.find((u) => u.isAdmin && !u.isDisabled)
  if (!admin) {
    throw new Error('No enabled administrator account found on the Jellyfin server')
  }

  adminUserIds.set(provider, admin.id)
  return admin.id
}

export async function updateJellyfinItem(
  provider: JellyfinProviderBase,
  apiKey: string,
  itemId: string,
  mutate: (item: Record<string, unknown>) => void
): Promise<void> {
  const adminUserId = await resolveAdminUserId(provider, apiKey)
  const item = await provider.fetch<Record<string, unknown>>(
    `/Users/${adminUserId}/Items/${itemId}`,
    apiKey
  )
  mutate(item)

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
  mutate: (item: Record<string, unknown>) => void,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await updateJellyfinItem(provider, apiKey, itemId, mutate)
  } catch (err) {
    logger.warn({ err, itemId, ...context }, 'Non-fatal Jellyfin item update failed')
  }
}
