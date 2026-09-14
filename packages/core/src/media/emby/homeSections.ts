/**
 * Emby home-screen sections (ContentService) and item tags (TagService).
 *
 * Shapes follow Emby's REST reference (dev.emby.media/reference/RestAPI). Two
 * properties of the API decide how callers must use these:
 *
 * - `POST /Users/{UserId}/HomeSections` creates when the body has no Id and
 *   answers with an EMPTY body, so a created section's Id can only be learnt by
 *   reading the list back. Nothing here returns one.
 * - A section filters by tag ID (`Query.TagIds`) while `/Items` filters by tag
 *   NAME (`Tags`). A tag has an id only once some item carries it, so a new
 *   tag's id is resolved after it has been applied.
 */

import type { ContentSection, MediaServerTag } from '../types.js'
import type { EmbyProviderBase } from './base.js'

interface EmbyTagQueryResult {
  Items?: Array<{ Id?: string | number; Name?: string }>
}

interface EmbyItemIdsResult {
  Items?: Array<{ Id: string }>
  TotalRecordCount?: number
}

const ITEM_PAGE_SIZE = 500

export async function getHomeSections(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string
): Promise<ContentSection[]> {
  const data = await provider.fetch<ContentSection[] | { Items?: ContentSection[] }>(
    `/Users/${encodeURIComponent(userId)}/HomeSections`,
    apiKey
  )
  // Documented as a list. Tolerate the QueryResult envelope most Emby lists use,
  // and the `{}` provider.fetch returns for an empty body.
  if (Array.isArray(data)) return data
  return Array.isArray(data?.Items) ? data.Items : []
}

export async function saveHomeSection(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  section: ContentSection
): Promise<void> {
  await provider.fetch(`/Users/${encodeURIComponent(userId)}/HomeSections`, apiKey, {
    method: 'POST',
    body: JSON.stringify(section),
  })
}

export async function deleteHomeSections(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  sectionIds: string[]
): Promise<void> {
  if (sectionIds.length === 0) return
  await provider.fetch(`/Users/${encodeURIComponent(userId)}/HomeSections/Delete`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ Ids: sectionIds }),
  })
}

export async function moveHomeSections(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string,
  sectionIds: string[],
  newIndex: number
): Promise<void> {
  if (sectionIds.length === 0) return
  await provider.fetch(`/Users/${encodeURIComponent(userId)}/HomeSections/Move`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ Ids: sectionIds, NewIndex: newIndex }),
  })
}

/**
 * Every tag whose name starts with `prefix`, with its id.
 *
 * The prefix is re-checked here rather than trusted to the server: the reference
 * describes `NameStartsWith` loosely enough ("matches or exceeds") that a sorted
 * range query is possible, and a tag we do not own must never be treated as one.
 */
export async function getTagsByPrefix(
  provider: EmbyProviderBase,
  apiKey: string,
  prefix: string
): Promise<MediaServerTag[]> {
  const params = new URLSearchParams({ NameStartsWith: prefix, Recursive: 'true' })
  const data = await provider.fetch<EmbyTagQueryResult>(`/Tags?${params}`, apiKey)
  const wanted = prefix.toLowerCase()
  const tags: MediaServerTag[] = []
  for (const tag of data?.Items ?? []) {
    if (typeof tag.Name !== 'string' || tag.Id == null) continue
    if (!tag.Name.toLowerCase().startsWith(wanted)) continue
    tags.push({ name: tag.Name, id: String(tag.Id) })
  }
  return tags
}

/** Ids of every movie and series carrying the tag, across all libraries. */
export async function getItemIdsWithTag(
  provider: EmbyProviderBase,
  apiKey: string,
  tagName: string
): Promise<string[]> {
  const ids: string[] = []
  let startIndex = 0

  while (true) {
    const params = new URLSearchParams({
      Tags: tagName,
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series',
      Fields: 'Id',
      StartIndex: String(startIndex),
      Limit: String(ITEM_PAGE_SIZE),
    })
    const page = await provider.fetch<EmbyItemIdsResult>(`/Items?${params}`, apiKey)
    const items = page?.Items ?? []
    for (const item of items) ids.push(item.Id)

    const total = page?.TotalRecordCount ?? 0
    if (items.length === 0 || startIndex + items.length >= total) break
    startIndex += items.length
  }

  return ids
}

function tagBody(tag: MediaServerTag): string {
  return JSON.stringify({ Tags: [tag.id ? { Name: tag.name, Id: tag.id } : { Name: tag.name }] })
}

export async function addItemTag(
  provider: EmbyProviderBase,
  apiKey: string,
  itemId: string,
  tag: MediaServerTag
): Promise<void> {
  await provider.fetch(`/Items/${encodeURIComponent(itemId)}/Tags/Add`, apiKey, {
    method: 'POST',
    body: tagBody(tag),
  })
}

export async function removeItemTag(
  provider: EmbyProviderBase,
  apiKey: string,
  itemId: string,
  tag: MediaServerTag
): Promise<void> {
  await provider.fetch(`/Items/${encodeURIComponent(itemId)}/Tags/Delete`, apiKey, {
    method: 'POST',
    body: tagBody(tag),
  })
}
