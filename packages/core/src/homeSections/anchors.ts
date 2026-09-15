/**
 * The rows a placement can be anchored to, read live from Emby.
 *
 * Nothing is cached: an anchor list that is a day old offers a row an admin has
 * since removed from everyone. Aperture's own rows are never offered — anchoring
 * one feature to another would make placement order-dependent in a way no
 * setting could explain.
 */

import { getMediaServerProvider } from '../media/index.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { isTopPicksTarget, sectionTagIds } from './plan.js'
import { isTypeMatchable } from './placement.js'
import { loadViewers } from './sources.js'

/** Emby answers quickly, but fifty accounts one after another is a long wait on a settings page. */
const READ_CONCURRENCY = 6

export interface HomeRowOption {
  id: string
  type: string | null
  name: string
}

export interface SharedHomeRow extends HomeRowOption {
  /** Accounts showing this row under this id. */
  accounts: number
  /** Accounts where an anchor on this row resolves: by id, or by a matchable type. */
  accountsWithType: number
}

export interface SharedHomeRows {
  /** Accounts whose home screen was read. */
  accounts: number
  /** Accounts the media server did not answer for. */
  unreadable: number
  rows: SharedHomeRow[]
}

function sectionName(section: ContentSection): string {
  const name = section.CustomName ?? section.Name
  return typeof name === 'string' && name.length > 0 ? name : String(section.Id)
}

async function managedTagIds(provider: MediaServerProvider, apiKey: string): Promise<Set<string>> {
  const tags = await provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX)
  return new Set(tags.map((tag) => tag.id).filter((id): id is string => !!id))
}

function isManagedSection(section: ContentSection, managed: ReadonlySet<string>): boolean {
  return sectionTagIds(section).some((id) => managed.has(id))
}

async function requireServer(): Promise<{ provider: MediaServerProvider; apiKey: string }> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) throw new Error('No media server API key is configured')
  return { provider, apiKey }
}

/**
 * Every row found on more than one account, with how many accounts have it and
 * how many an anchor on it would resolve for — the difference is what the admin
 * picks a fallback for. A row on one account is someone's own and cannot anchor
 * anyone else's, so it is left out unless there is only one account to read.
 */
export async function listSharedHomeRows(): Promise<SharedHomeRows> {
  const { provider, apiKey } = await requireServer()
  const viewers = (await loadViewers(provider.type)).filter((viewer) =>
    isTopPicksTarget({ providerDisabled: viewer.provider_disabled })
  )
  const managed = await managedTagIds(provider, apiKey)

  const screens: ContentSection[][] = []
  let unreadable = 0
  let next = 0
  const worker = async () => {
    while (next < viewers.length) {
      const viewer = viewers[next++]
      try {
        screens.push(await provider.getHomeSections(apiKey, viewer.provider_user_id))
      } catch {
        unreadable++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, viewers.length) }, worker))

  const byId = new Map<string, { type: string | null; names: Map<string, number>; accounts: number }>()
  const accountsByType = new Map<string, number>()
  for (const sections of screens) {
    const seenIds = new Set<string>()
    const seenTypes = new Set<string>()
    for (const section of sections) {
      if (!section.Id || isManagedSection(section, managed)) continue
      const id = String(section.Id)
      const type = typeof section.SectionType === 'string' ? section.SectionType : null
      if (type) seenTypes.add(type)
      if (seenIds.has(id)) continue
      seenIds.add(id)
      const entry = byId.get(id) ?? { type, names: new Map<string, number>(), accounts: 0 }
      entry.accounts++
      const name = sectionName(section)
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1)
      byId.set(id, entry)
    }
    for (const type of seenTypes) accountsByType.set(type, (accountsByType.get(type) ?? 0) + 1)
  }

  const rows: SharedHomeRow[] = [...byId.entries()]
    .filter(([, entry]) => entry.accounts >= 2 || screens.length < 2)
    .map(([id, entry]) => {
      const name = [...entry.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? id
      return {
        id,
        type: entry.type,
        name,
        accounts: entry.accounts,
        accountsWithType: isTypeMatchable(entry.type)
          ? Math.max(entry.accounts, accountsByType.get(entry.type) ?? 0)
          : entry.accounts,
      }
    })
    .sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name))

  return { accounts: screens.length, unreadable, rows }
}

/** One account's own rows, in the order that account sees them. */
export async function listOwnHomeRows(providerUserId: string): Promise<HomeRowOption[]> {
  const { provider, apiKey } = await requireServer()
  const [sections, managed] = await Promise.all([
    provider.getHomeSections(apiKey, providerUserId),
    managedTagIds(provider, apiKey),
  ])
  const seen = new Set<string>()
  const rows: HomeRowOption[] = []
  for (const section of sections) {
    if (!section.Id || isManagedSection(section, managed)) continue
    const id = String(section.Id)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({ id, type: typeof section.SectionType === 'string' ? section.SectionType : null, name: sectionName(section) })
  }
  return rows
}
