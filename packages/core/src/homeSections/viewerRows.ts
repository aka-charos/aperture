/**
 * One viewer's managed rows: which of their sections are Aperture's, and moving
 * the ones whose placement changed. Shared by the nightly sync and the instant
 * paths, so a row placed now lands where the next sync would put it.
 */

import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import { TOP_PICKS_TAGS, recsTagNames, sectionTagIds } from './plan.js'
import {
  placementChain,
  placementKey,
  planPlacement,
  type FeaturePlacement,
  type HomeScreenRow,
  type Placement,
  type PlacementFeature,
} from './placement.js'
import { saveAppliedPlacementKeys } from './placementStore.js'
import type { HomePlaylist } from './playlists.js'

export interface ManagedTagInfo {
  feature: PlacementFeature
  /** Orders rows within a feature; the playlist's name for a playlist row. */
  name: string
}

/**
 * Every tag that could back a row on this viewer's home screen, by tag id.
 * Recognition only — a row being Aperture's is what keeps it out of position
 * counting and anchor matching, whether or not its feature is switched on.
 */
export function managedTagsForViewer(input: {
  viewerId: string
  viewerTagName: string | undefined
  playlists: readonly HomePlaylist[]
  tagIdByName: ReadonlyMap<string, string>
}): Map<string, ManagedTagInfo> {
  const managed = new Map<string, ManagedTagInfo>()
  const add = (tagName: string, info: ManagedTagInfo) => {
    const id = input.tagIdByName.get(tagName.toLowerCase())
    if (id) managed.set(id, info)
  }
  add(TOP_PICKS_TAGS['top-picks-movies'], { feature: 'top-picks-movies', name: '' })
  add(TOP_PICKS_TAGS['top-picks-series'], { feature: 'top-picks-series', name: '' })
  if (input.viewerTagName) {
    const names = recsTagNames(input.viewerTagName)
    add(names.movies, { feature: 'recs-movies', name: '' })
    add(names.series, { feature: 'recs-series', name: '' })
  }
  for (const playlist of input.playlists) {
    if (playlist.ownerId === input.viewerId) add(playlist.tagName, { feature: 'playlists', name: playlist.name })
  }
  return managed
}

/** A viewer's sections as placement rows, in Emby's order. */
export function toHomeScreenRows(
  sections: readonly ContentSection[],
  managed: ReadonlyMap<string, ManagedTagInfo>
): HomeScreenRow[] {
  const rows: HomeScreenRow[] = []
  for (const section of sections) {
    if (!section.Id) continue
    const tagId = sectionTagIds(section).find((id) => managed.has(id))
    const info = tagId ? managed.get(tagId) : undefined
    rows.push({
      id: String(section.Id),
      sectionType: typeof section.SectionType === 'string' ? section.SectionType : null,
      feature: info?.feature ?? null,
      name: info?.name || String(section.CustomName ?? section.Name ?? ''),
    })
  }
  return rows
}

export interface PlaceViewerRowsInput {
  provider: MediaServerProvider
  apiKey: string
  /** Aperture's user id: applied placements are stored against it. */
  userId: string
  providerUserId: string
  /** The viewer's sections as they are now, in Emby's order. */
  sections: readonly ContentSection[]
  managed: ReadonlyMap<string, ManagedTagInfo>
  defaults: Record<PlacementFeature, FeaturePlacement>
  overrides: ReadonlyMap<PlacementFeature, Placement> | undefined
  applied: ReadonlyMap<PlacementFeature, string> | undefined
  /** Features placed whatever was applied before: a row of theirs was just created. */
  force: ReadonlySet<PlacementFeature>
}

/**
 * Move the rows of every feature whose placement differs from what was last
 * applied to this viewer, or that was just created. Nothing else moves, so a
 * viewer who dragged a row keeps it until the placement that applies changes.
 * The applied keys are saved only after every move succeeded; a failure throws
 * and the next run tries again.
 */
export async function placeViewerRows(input: PlaceViewerRowsInput): Promise<{ moved: number; placed: PlacementFeature[] }> {
  const rows = toHomeScreenRows(input.sections, input.managed)
  const present = new Set(rows.flatMap((row) => (row.feature ? [row.feature] : [])))

  const chains = new Map<PlacementFeature, Placement[]>()
  const keys = new Map<PlacementFeature, string>()
  for (const feature of present) {
    const chain = placementChain(input.defaults[feature], input.overrides?.get(feature) ?? null)
    const key = placementKey(chain)
    if (input.force.has(feature) || input.applied?.get(feature) !== key) {
      chains.set(feature, chain)
      keys.set(feature, key)
    }
  }
  if (chains.size === 0) return { moved: 0, placed: [] }

  const plan = planPlacement(rows, chains)
  for (const move of plan.moves) {
    await input.provider.moveHomeSections(input.apiKey, input.providerUserId, [move.id], move.index)
  }
  await saveAppliedPlacementKeys(input.userId, keys)
  return { moved: plan.moves.length, placed: [...chains.keys()] }
}
