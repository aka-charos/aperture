/**
 * The steps every write to a viewer's home screen shares, whoever starts it —
 * the nightly sync for everyone, or the instant path for one viewer who just
 * switched a row on or off. One copy, so a row switched on now is written
 * exactly as the next sync would write it:
 *
 * 1. `writeTagMembership` — make one tag hold exactly the planned items.
 * 2. `viewerDesiredRows` — which rows one viewer should have, from their row
 *    states (rowStates.ts) and what each tag holds.
 * 3. `reconcileViewerScreen` — create, update and remove that viewer's
 *    sections, then place what moved (viewerRows.ts).
 */

import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import {
  TOP_PICKS_TAGS,
  diffMembership,
  featureOfKind,
  friendsTagName,
  planViewerSections,
  recsTagNames,
  sectionTagIds,
  type DesiredRow,
  type ManagedRowKind,
} from './plan.js'
import type { FeaturePlacement, Placement, PlacementFeature } from './placement.js'
import type { HomePlaylist } from './playlists.js'
import type { RowState } from './rowStates.js'
import type { HomeSectionsConfig } from './settings.js'
import { placeViewerRows, type ManagedTagInfo } from './viewerRows.js'

/** What a tag should hold this run. `ids: null` means "could not tell — leave it". */
export interface TagPlan {
  name: string
  ids: string[] | null
}

/**
 * Tag and untag items so `plan.name` holds exactly `ids`. A failure on one item
 * is reported and the rest continue; a failure to read the tag's current
 * membership throws, and the caller treats the tag as unknown.
 */
export async function writeTagMembership(input: {
  provider: MediaServerProvider
  apiKey: string
  name: string
  ids: readonly string[]
  /** The tag's id as the server has it now; absent when no item carries it yet. */
  existingId: string | undefined
  onItemError: (scope: string, err: unknown) => void
}): Promise<{ applied: number; removed: number }> {
  const { provider, apiKey, name } = input
  if (!input.existingId && input.ids.length === 0) return { applied: 0, removed: 0 }

  const current = input.existingId ? await provider.getItemIdsWithTag(apiKey, name) : []
  const { add, remove } = diffMembership(current, input.ids)
  const tag = { name, id: input.existingId }
  let applied = 0
  let removed = 0
  for (const itemId of add) {
    try {
      await provider.addItemTag(apiKey, itemId, tag)
      applied++
    } catch (err) {
      input.onItemError(`tag ${name} +${itemId}`, err)
    }
  }
  for (const itemId of remove) {
    try {
      await provider.removeItemTag(apiKey, itemId, tag)
      removed++
    } catch (err) {
      input.onItemError(`tag ${name} -${itemId}`, err)
    }
  }
  return { applied, removed }
}

export type RowNames = Pick<
  HomeSectionsConfig,
  'topPicksMoviesName' | 'topPicksSeriesName' | 'recommendationsMoviesName' | 'recommendationsSeriesName' | 'friendsName'
>

export interface ViewerDesiredRows {
  desired: DesiredRow[]
  /** Rows whose contents could not be worked out: left exactly as they are. */
  preserveTagIds: Set<string>
  /** Every row of this viewer's that is Aperture's, by tag id, for placement. */
  managed: Map<string, ManagedTagInfo>
}

/**
 * The rows one viewer should have. A row is wanted when its state is `on` and
 * its tag holds something; a row whose contents are unknown this run is
 * preserved; anything else of ours on their screen is removed by the plan.
 */
export function viewerDesiredRows(input: {
  viewerId: string
  states: Readonly<Record<PlacementFeature, RowState>>
  names: RowNames
  sortBy: HomeSectionsConfig['sortBy']
  viewerTagName: string | undefined
  playlists: readonly HomePlaylist[]
  /** What each tag should hold, keyed by lower-cased tag name. */
  tagPlans: ReadonlyMap<string, TagPlan>
  /** Tag ids by lower-cased name as the server has them after this run's tagging. */
  tagIdByName: ReadonlyMap<string, string>
  /** Tag ids by lower-cased name from before this run's tagging. */
  idBefore: ReadonlyMap<string, string>
}): ViewerDesiredRows {
  const desired: DesiredRow[] = []
  const preserveTagIds = new Set<string>()
  const managed = new Map<string, ManagedTagInfo>()
  const on = (feature: PlacementFeature) => input.states[feature].status === 'on'

  const considerRow = (kind: ManagedRowKind, tagName: string, name: string, itemTypes: string[]) => {
    const key = tagName.toLowerCase()
    const plan = input.tagPlans.get(key)
    const tagId = input.tagIdByName.get(key) ?? input.idBefore.get(key)
    if (!plan || !tagId) return
    if (plan.ids === null) {
      preserveTagIds.add(tagId)
      managed.set(tagId, { feature: featureOfKind(kind), name })
    } else if (plan.ids.length > 0 && input.tagIdByName.has(key)) {
      desired.push({ kind, tagId, name, itemTypes, sortBy: input.sortBy })
      managed.set(tagId, { feature: featureOfKind(kind), name })
    }
  }

  if (on('top-picks-movies')) {
    considerRow('top-picks-movies', TOP_PICKS_TAGS['top-picks-movies'], input.names.topPicksMoviesName, ['Movie'])
  }
  if (on('top-picks-series')) {
    considerRow('top-picks-series', TOP_PICKS_TAGS['top-picks-series'], input.names.topPicksSeriesName, ['Series'])
  }
  if (input.viewerTagName) {
    const names = recsTagNames(input.viewerTagName)
    if (on('recs-movies')) considerRow('recs-movies', names.movies, input.names.recommendationsMoviesName, ['Movie'])
    if (on('recs-series')) considerRow('recs-series', names.series, input.names.recommendationsSeriesName, ['Series'])
    if (on('friends')) {
      considerRow('friends', friendsTagName(input.viewerTagName), input.names.friendsName, ['Movie', 'Series'])
    }
  }
  if (on('playlists')) {
    for (const playlist of input.playlists) {
      if (playlist.ownerId === input.viewerId) {
        considerRow('playlist', playlist.tagName, playlist.name, ['Movie', 'Series'])
      }
    }
  }
  return { desired, preserveTagIds, managed }
}

export interface ReconcileResult {
  created: number
  updated: number
  removed: number
  moved: number
}

/**
 * Bring one viewer's home screen in line with their desired rows: remove,
 * update, create, then place the rows whose placement changed or that were just
 * created. `sections` is their screen as just read.
 */
export async function reconcileViewerScreen(input: {
  provider: MediaServerProvider
  apiKey: string
  userId: string
  providerUserId: string
  sections: readonly ContentSection[]
  /** Every managed tag the server has had this run, before and after tagging. */
  managedTagIds: ReadonlySet<string>
  rows: ViewerDesiredRows
  defaults: Record<PlacementFeature, FeaturePlacement>
  overrides: ReadonlyMap<PlacementFeature, Placement> | undefined
  applied: ReadonlyMap<PlacementFeature, string> | undefined
}): Promise<ReconcileResult> {
  const { provider, apiKey, providerUserId, rows } = input
  const result: ReconcileResult = { created: 0, updated: 0, removed: 0, moved: 0 }
  const plan = planViewerSections({
    existing: input.sections,
    managedTagIds: input.managedTagIds,
    desired: rows.desired,
    preserveTagIds: rows.preserveTagIds,
  })

  if (plan.deletes.length > 0) {
    await provider.deleteHomeSections(apiKey, providerUserId, plan.deletes)
    result.removed += plan.deletes.length
  }
  for (const section of plan.updates) {
    await provider.saveHomeSection(apiKey, providerUserId, section)
    result.updated++
  }
  const created = new Set<PlacementFeature>()
  for (const section of plan.creates) {
    await provider.saveHomeSection(apiKey, providerUserId, section)
    result.created++
    const info = rows.managed.get(sectionTagIds(section)[0] ?? '')
    if (info) created.add(info.feature)
  }

  if (rows.managed.size > 0) {
    // A created section's id is only learnable by reading the list back.
    const current =
      plan.creates.length > 0 || plan.deletes.length > 0
        ? await provider.getHomeSections(apiKey, providerUserId)
        : input.sections
    const placed = await placeViewerRows({
      provider,
      apiKey,
      userId: input.userId,
      providerUserId,
      sections: current,
      managed: rows.managed,
      defaults: input.defaults,
      overrides: input.overrides,
      applied: input.applied,
      force: created,
    })
    result.moved += placed.moved
  }
  return result
}
