/**
 * What a viewer's Emby home screen will look like once their rows are applied:
 * their own rows where they are, Aperture's rows switched off taken out, rows
 * switched on but not there yet put in, and every row placed as the next write
 * would place it. Pure, so the settings page can show it without writing
 * anything, and pinned by a test against the same planner the writes use.
 *
 * It follows `placeViewerRows`' rule exactly: a row moves only when it is being
 * created or its placement changed since it was last applied, so a row the
 * viewer dragged in Emby is shown where they dragged it, not where a default
 * would put it.
 */

import type { ContentSection } from '../media/types.js'
import { sectionTagIds } from './plan.js'
import {
  collapseExpandedRows,
  placementChain,
  placementKey,
  planPlacement,
  type FeaturePlacement,
  type HomeScreenRow,
  type Placement,
  type PlacementFeature,
} from './placement.js'

export interface ProjectedRow {
  /** Emby's section id, or a key of its own for a row not created yet. */
  id: string
  name: string
  /** The feature an Aperture row belongs to; null for the viewer's own rows. */
  feature: PlacementFeature | null
  /** Several per-library rows Emby stores as one (Latest Media). */
  group?: boolean
  /** An Aperture row that is not on the screen yet: it is created when the rows are next applied. */
  pending?: boolean
}

export interface WantedRow {
  /**
   * The id of the tag the row queries, or — for a row whose tag does not exist
   * yet — any key that is not a tag id.
   */
  key: string
  feature: PlacementFeature
  name: string
}

const PENDING_PREFIX = 'pending:'

function sectionName(section: ContentSection): string {
  const name = section.CustomName ?? section.Name
  return typeof name === 'string' && name.length > 0 ? name : String(section.Id)
}

export function projectHomeScreen(input: {
  /** The viewer's sections as Emby returns them now. */
  sections: readonly ContentSection[]
  /** Every managed tag id: a section querying one is Aperture's, wanted or not. */
  managedTagIds: ReadonlySet<string>
  /** The rows the viewer will have once applied. An Aperture row not here is removed. */
  wanted: readonly WantedRow[]
  defaults: Record<PlacementFeature, FeaturePlacement>
  overrides: ReadonlyMap<PlacementFeature, Placement> | undefined
  applied: ReadonlyMap<PlacementFeature, string> | undefined
}): ProjectedRow[] {
  const wantedByKey = new Map(input.wanted.map((row) => [row.key, row]))
  const rows: HomeScreenRow[] = []
  const present = new Set<string>()

  for (const section of input.sections) {
    if (!section.Id) continue
    const id = String(section.Id)
    const sectionType = typeof section.SectionType === 'string' ? section.SectionType : null
    const ours = sectionTagIds(section).find((tagId) => input.managedTagIds.has(tagId) || wantedByKey.has(tagId))
    if (!ours) {
      rows.push({ id, sectionType, feature: null, name: sectionName(section) })
      continue
    }
    const want = wantedByKey.get(ours)
    // Not wanted: switched off, emptied or orphaned — the write removes it. A
    // second section on one tag is a duplicate the write removes too.
    if (!want || present.has(ours)) continue
    present.add(ours)
    rows.push({ id, sectionType, feature: want.feature, name: want.name })
  }

  const created = new Set<PlacementFeature>()
  for (const want of input.wanted) {
    if (present.has(want.key)) continue
    present.add(want.key)
    rows.push({ id: `${PENDING_PREFIX}${want.key}`, sectionType: null, feature: want.feature, name: want.name })
    created.add(want.feature)
  }

  const chains = new Map<PlacementFeature, Placement[]>()
  for (const feature of new Set(rows.flatMap((row) => (row.feature ? [row.feature] : [])))) {
    const chain = placementChain(input.defaults[feature], input.overrides?.get(feature) ?? null)
    if (created.has(feature) || input.applied?.get(feature) !== placementKey(chain)) chains.set(feature, chain)
  }

  const byId = new Map(collapseExpandedRows(rows).map((row) => [row.id, row]))
  return planPlacement(rows, chains).order.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    return [
      {
        id,
        name: row.name,
        feature: row.feature,
        ...(row.group ? { group: true } : {}),
        ...(id.startsWith(PENDING_PREFIX) ? { pending: true } : {}),
      },
    ]
  })
}
