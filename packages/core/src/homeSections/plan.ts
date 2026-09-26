/**
 * The reconcile logic for managed home sections, kept pure so it can be pinned.
 *
 * The one idea everything here rests on: a managed row is a dynamic-media
 * section (`SectionType: "items"`) whose query is exactly one `aperture:` tag,
 * and that tag is how the row is recognised when the viewer's sections are read
 * back. Emby answers a section POST with an empty body, so a created row's id is
 * not otherwise knowable; a stored id would go stale the moment a viewer deleted
 * the row; and a text marker would sit in a field the viewer can read or rename.
 * The tag id has none of those problems and is already ours.
 */

import type { ContentSection } from '../media/types.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import { sortOrderFor, type HomeSectionSort } from './settings.js'
import type { PlacementFeature } from './placement.js'

/**
 * Emby's section type for a query-backed row of media, as opposed to `boxset`
 * (one collection's children). The REST reference leaves the vocabulary
 * undocumented; this is the value Emby's own editor writes for a tag row, and
 * what the Home Screen Companion plugin uses for the same purpose.
 */
export const HOME_SECTION_TYPE = 'items'

export type ManagedRowKind = 'top-picks-movies' | 'top-picks-series' | 'recs-movies' | 'recs-series' | 'playlist'

/** The placement feature a row belongs to. Every playlist row shares one. */
export function featureOfKind(kind: ManagedRowKind): PlacementFeature {
  return kind === 'playlist' ? 'playlists' : kind
}

export const TOP_PICKS_TAGS: Readonly<Record<'top-picks-movies' | 'top-picks-series', string>> = {
  'top-picks-movies': `${MANAGED_TAG_PREFIX}top-picks-movies`,
  'top-picks-series': `${MANAGED_TAG_PREFIX}top-picks-series`,
}

export const RECS_TAG_PREFIX = `${MANAGED_TAG_PREFIX}recs-`

/** The name stored for a viewer, from their random token. */
export function recsTagName(token: string): string {
  return `${RECS_TAG_PREFIX}${token}`
}

/**
 * The two tags a viewer's recommendation rows query, derived from the name
 * stored for them. Movies and series are separate rows with separate placements,
 * so each needs its own tag: a section is recognised by the one tag it queries.
 * The stored name itself backed 0173's mixed row, holds nothing now, and is
 * stripped as an orphan by the first sync after 0175.
 */
export function recsTagNames(viewerTagName: string): { movies: string; series: string } {
  return { movies: `${viewerTagName}-movies`, series: `${viewerTagName}-series` }
}

export const PLAYLIST_TAG_PREFIX = `${MANAGED_TAG_PREFIX}playlist-`

/** A generated playlist's tag, from the random token stored on the playlist. */
export function playlistTagName(token: string): string {
  return `${PLAYLIST_TAG_PREFIX}${token}`
}

export interface HomeSectionViewer {
  isEnabled: boolean
  providerDisabled: boolean
}

/**
 * Whose home screen gets PERSONAL rows — their own recommendations and the
 * playlists they chose. `is_enabled` is the operator's consent to Aperture acting
 * for that account; `provider_disabled` means the media server has dropped them,
 * which every other per-user loop in core also refuses (and STRM cleanup treats
 * as grounds to delete output). A viewer who fails this gets those rows REMOVED,
 * not merely skipped, or the rows would outlive the consent that created them.
 */
export function isHomeSectionTarget(viewer: HomeSectionViewer): boolean {
  return viewer.isEnabled && !viewer.providerDisabled
}

/**
 * Whose home screen gets the Top Picks rows: every account with access, and —
 * when `withoutAccess` is set, which is the default — every account the media
 * server has not disabled, whether it has access here or not. Top Picks is one
 * list for the whole server and says nothing about the person looking at it, so
 * it does not need the consent a viewer's own picks do; whether it should reach
 * people who were deliberately given no access is the operator's call
 * (`home_sections_config.top_picks_without_access`, 0184). The user sync imports
 * every account on the server, so the users table is everyone — bar accounts
 * created since it last ran. A `provider_disabled` account always has its rows
 * removed.
 *
 * `withoutAccess` is required rather than defaulted: a default is a decision a
 * caller can forget, and forgetting this one puts rows back on the screens of the
 * people an operator switched it off for.
 */
export function isTopPicksTarget(viewer: HomeSectionViewer, withoutAccess: boolean): boolean {
  if (viewer.providerDisabled) return false
  return viewer.isEnabled || withoutAccess
}

/**
 * Whether a viewer can receive ANY managed row — the population whose home
 * screens anchors are read from, and the one an instant placement may touch.
 */
export function mayReceiveHomeRows(viewer: HomeSectionViewer, topPicksWithoutAccess: boolean): boolean {
  return isHomeSectionTarget(viewer) || isTopPicksTarget(viewer, topPicksWithoutAccess)
}

export interface MembershipDiff {
  add: string[]
  remove: string[]
}

/** Which items to tag and untag to turn `current` into `desired`. */
export function diffMembership(current: readonly string[], desired: readonly string[]): MembershipDiff {
  const have = new Set(current)
  const want = new Set(desired)
  return {
    add: [...want].filter((id) => !have.has(id)),
    remove: [...have].filter((id) => !want.has(id)),
  }
}

export interface DesiredRow {
  kind: ManagedRowKind
  tagId: string
  name: string
  itemTypes: readonly string[]
  sortBy: HomeSectionSort
}

/** The tag ids a section's query filters on, as strings. */
export function sectionTagIds(section: ContentSection): string[] {
  const ids = section.Query?.TagIds
  return Array.isArray(ids) ? ids.map((id) => String(id)) : []
}

/**
 * The section to write for a row. Built ON TOP of the existing section when
 * there is one, so anything Aperture does not own — display mode, image type,
 * an extra filter the viewer added in Emby — survives the update.
 */
export function buildSection(row: DesiredRow, existing?: ContentSection): ContentSection {
  const section: ContentSection = {
    ...(existing ?? {}),
    SectionType: HOME_SECTION_TYPE,
    CustomName: row.name,
    ItemTypes: [...row.itemTypes],
    Query: { ...(existing?.Query ?? {}), TagIds: [row.tagId] },
    SortBy: row.sortBy,
    SortOrder: sortOrderFor(row.sortBy),
  }
  if (!existing) delete section.Id
  return section
}

function sameList(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  const left = (a ?? []).map(String).sort()
  const right = (b ?? []).map(String).sort()
  return left.length === right.length && left.every((value, i) => value === right[i])
}

/** Whether writing `desired` over `existing` would change anything we own. */
export function sectionDiffers(existing: ContentSection, desired: ContentSection): boolean {
  return (
    existing.SectionType !== desired.SectionType ||
    existing.CustomName !== desired.CustomName ||
    existing.SortBy !== desired.SortBy ||
    existing.SortOrder !== desired.SortOrder ||
    !sameList(existing.ItemTypes, desired.ItemTypes) ||
    !sameList(sectionTagIds(existing), sectionTagIds(desired))
  )
}

export interface ViewerSectionPlan {
  creates: ContentSection[]
  updates: ContentSection[]
  deletes: string[]
  /**
   * The section already on the server for each desired row, keyed by the row's
   * TAG id — a viewer can have several playlist rows, so kind cannot be the key.
   */
  existingIds: Map<string, string>
}

/**
 * Reconcile one viewer's home screen.
 *
 * - `managedTagIds`: ids of every `aperture:` tag the server has had this run,
 *   before AND after the tag writes — a section still pointing at a tag this run
 *   emptied away must be recognised as ours to be removed.
 * - `preserveTagIds`: rows whose contents could not be worked out this run (a
 *   Top Picks source threw, a query failed). Their sections are left exactly as
 *   they are — a failure must never read as "this row should be empty".
 *
 * Sections that query no managed tag are not ours and are never touched.
 */
export function planViewerSections(input: {
  existing: readonly ContentSection[]
  managedTagIds: ReadonlySet<string>
  desired: readonly DesiredRow[]
  preserveTagIds: ReadonlySet<string>
}): ViewerSectionPlan {
  const plan: ViewerSectionPlan = { creates: [], updates: [], deletes: [], existingIds: new Map<string, string>() }

  const recognised = new Set<string>([
    ...input.managedTagIds,
    ...input.preserveTagIds,
    ...input.desired.map((row) => row.tagId),
  ])

  const byTag = new Map<string, ContentSection[]>()
  for (const section of input.existing) {
    if (!section.Id) continue
    const owner = sectionTagIds(section).find((id) => recognised.has(id))
    if (!owner) continue
    const group = byTag.get(owner) ?? []
    group.push(section)
    byTag.set(owner, group)
  }

  const handled = new Set<string>()
  for (const row of input.desired) {
    if (handled.has(row.tagId)) continue
    handled.add(row.tagId)

    const [keep, ...duplicates] = byTag.get(row.tagId) ?? []
    if (!keep) {
      plan.creates.push(buildSection(row))
      continue
    }
    plan.existingIds.set(row.tagId, keep.Id as string)
    const desired = buildSection(row, keep)
    if (sectionDiffers(keep, desired)) plan.updates.push(desired)
    for (const duplicate of duplicates) plan.deletes.push(duplicate.Id as string)
  }

  for (const [tagId, sections] of byTag) {
    if (handled.has(tagId) || input.preserveTagIds.has(tagId)) continue
    for (const section of sections) plan.deletes.push(section.Id as string)
  }

  return plan
}
