/**
 * The rows a placement can be anchored to, read live from Emby.
 *
 * Nothing is cached: an anchor list that is a day old offers a row an admin has
 * since removed from everyone. Aperture's own rows are never offered — anchoring
 * one feature to another would make placement order-dependent in a way no
 * setting could explain. Per-library expansions (every library's Latest row) are
 * offered as the one group Emby stores them as, because nothing can be placed
 * between two of them.
 */

import { getMediaServerProvider } from '../media/index.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { isTopPicksTarget, sectionTagIds } from './plan.js'
import { collapseExpandedRows, isTypeMatchable, type HomeScreenRow } from './placement.js'
import { loadViewers } from './sources.js'

/** Emby answers quickly, but fifty accounts one after another is a long wait on a settings page. */
const READ_CONCURRENCY = 6

export interface HomeRowOption {
  id: string
  type: string | null
  name: string
  /** True for a group of per-library rows offered as one (Latest Media). */
  group?: boolean
}

export interface SharedHomeRow extends HomeRowOption {
  /** Accounts showing this row under this id. */
  accounts: number
  /** Accounts where an anchor on this row resolves: by id, or by a matchable type. */
  accountsWithType: number
  /**
   * The accounts it would NOT resolve for — the ones a fallback applies to.
   * Worked out from the same matching as `accountsWithType`, so the names always
   * add up to the count shown beside them.
   */
  missingAccounts: string[]
}

export interface SharedHomeRows {
  /** Accounts whose home screen was read. */
  accounts: number
  /** Accounts the media server did not answer for. */
  unreadable: number
  unreadableAccounts: string[]
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

/** A home screen's own rows, groups collapsed, Aperture's rows left out. */
function ownRows(sections: readonly ContentSection[], managed: ReadonlySet<string>): HomeScreenRow[] {
  const rows: HomeScreenRow[] = []
  for (const section of sections) {
    if (!section.Id || sectionTagIds(section).some((id) => managed.has(id))) continue
    rows.push({
      id: String(section.Id),
      sectionType: typeof section.SectionType === 'string' ? section.SectionType : null,
      feature: null,
      name: sectionName(section),
    })
  }
  return collapseExpandedRows(rows)
}

async function requireServer(): Promise<{ provider: MediaServerProvider; apiKey: string }> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) throw new Error('No media server API key is configured')
  return { provider, apiKey }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/**
 * Every row found on more than one account, with how many accounts have it,
 * how many an anchor on it would resolve for, and which accounts it would not —
 * the ones the admin picks a fallback for. A row on one account is someone's own
 * and cannot anchor anyone else's, so it is left out unless there is only one
 * account to read.
 */
export async function listSharedHomeRows(): Promise<SharedHomeRows> {
  const { provider, apiKey } = await requireServer()
  const viewers = (await loadViewers(provider.type)).filter((viewer) =>
    isTopPicksTarget({ providerDisabled: viewer.provider_disabled })
  )
  const managed = await managedTagIds(provider, apiKey)

  const screens: Array<{ viewerId: string; rows: HomeScreenRow[] }> = []
  const unreadableAccounts: string[] = []
  let next = 0
  const worker = async () => {
    while (next < viewers.length) {
      const viewer = viewers[next++]
      try {
        const sections = await provider.getHomeSections(apiKey, viewer.provider_user_id)
        screens.push({ viewerId: viewer.id, rows: ownRows(sections, managed) })
      } catch {
        unreadableAccounts.push(viewer.username)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, viewers.length) }, worker))

  const usernames = new Map(viewers.map((viewer) => [viewer.id, viewer.username]))
  const byId = new Map<
    string,
    { type: string | null; group: boolean; names: Map<string, number>; holders: Set<string> }
  >()
  const holdersByType = new Map<string, Set<string>>()

  for (const { viewerId, rows } of screens) {
    for (const row of rows) {
      if (row.sectionType) {
        const holders = holdersByType.get(row.sectionType) ?? new Set<string>()
        holders.add(viewerId)
        holdersByType.set(row.sectionType, holders)
      }
      const entry = byId.get(row.id) ?? {
        type: row.sectionType,
        group: row.group === true,
        names: new Map<string, number>(),
        holders: new Set<string>(),
      }
      // An account holding a row twice counts once, name and all.
      if (!entry.holders.has(viewerId)) {
        entry.names.set(row.name, (entry.names.get(row.name) ?? 0) + 1)
        entry.holders.add(viewerId)
      }
      byId.set(row.id, entry)
    }
  }

  const rows: SharedHomeRow[] = [...byId.entries()]
    .filter(([, entry]) => entry.holders.size >= 2 || screens.length < 2)
    .map(([id, entry]) => {
      const reached = new Set(entry.holders)
      if (isTypeMatchable(entry.type)) {
        for (const viewerId of holdersByType.get(entry.type) ?? []) reached.add(viewerId)
      }
      return {
        id,
        type: entry.type,
        name: [...entry.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? id,
        ...(entry.group ? { group: true } : {}),
        accounts: entry.holders.size,
        accountsWithType: reached.size,
        missingAccounts: screens
          .filter((screen) => !reached.has(screen.viewerId))
          .map((screen) => usernames.get(screen.viewerId) ?? screen.viewerId)
          .sort(byName),
      }
    })
    .sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name))

  return {
    accounts: screens.length,
    unreadable: unreadableAccounts.length,
    unreadableAccounts: unreadableAccounts.sort(byName),
    rows,
  }
}

/** One account's own rows, in the order that account sees them, groups collapsed. */
export async function listOwnHomeRows(providerUserId: string): Promise<HomeRowOption[]> {
  const { provider, apiKey } = await requireServer()
  const [sections, managed] = await Promise.all([
    provider.getHomeSections(apiKey, providerUserId),
    managedTagIds(provider, apiKey),
  ])
  const seen = new Set<string>()
  const options: HomeRowOption[] = []
  for (const row of ownRows(sections, managed)) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    options.push({ id: row.id, type: row.sectionType, name: row.name, ...(row.group ? { group: true } : {}) })
  }
  return options
}
