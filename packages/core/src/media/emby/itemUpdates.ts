/**
 * Emby item update helpers — fetch/modify/post pattern required by the Emby API.
 */

import { logger } from './base.js'
import type { EmbyProviderBase } from './base.js'

export async function updateEmbyItem(
  provider: EmbyProviderBase,
  apiKey: string,
  fetchPath: string,
  mutate: (item: Record<string, unknown>) => void | boolean
): Promise<string> {
  const item = await provider.fetch<Record<string, unknown>>(fetchPath, apiKey)
  const itemId = (item.Id as string) || fetchPath.split('/').pop() || ''
  // A mutate that returns false leaves the item alone: nothing is posted
  if (mutate(item) === false) return itemId

  await provider.fetch(`/Items/${itemId}`, apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })

  return itemId
}

export async function updateEmbyItemSafely(
  provider: EmbyProviderBase,
  apiKey: string,
  fetchPath: string,
  mutate: (item: Record<string, unknown>) => void | boolean,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await updateEmbyItem(provider, apiKey, fetchPath, mutate)
  } catch (err) {
    logger.warn({ err, ...context }, 'Non-fatal Emby item update failed')
  }
}
