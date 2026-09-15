/**
 * Stored placements (0175): the admin default per feature, each viewer's
 * overrides, and the placement last applied to each viewer's rows — which is how
 * a sync knows whose rows to move without overruling a viewer who dragged one.
 */

import { query } from '../lib/db.js'
import {
  DEFAULT_FEATURE_PLACEMENT,
  FALLBACK_MODES,
  PLACEMENT_FEATURES,
  PLACEMENT_MODES,
  isAnchorMode,
  isPlacementFeature,
  type FallbackMode,
  type FeaturePlacement,
  type Placement,
  type PlacementFeature,
  type PlacementMode,
} from './placement.js'

interface PlacementColumns {
  mode: string
  position: number
  anchor_id: string | null
  anchor_type: string | null
  anchor_name: string | null
}

/** A stored row as a placement; null for one edited in SQL into something unusable. */
function toPlacement(row: PlacementColumns): Placement | null {
  if (!(PLACEMENT_MODES as readonly string[]).includes(row.mode)) return null
  const mode = row.mode as PlacementMode
  if (isAnchorMode(mode)) {
    if (!row.anchor_id) return null
    return { mode, position: 0, anchor: { id: row.anchor_id, type: row.anchor_type, name: row.anchor_name } }
  }
  return { mode, position: mode === 'position' ? row.position : 0, anchor: null }
}

function placementValues(placement: Placement): [string, number, string | null, string | null, string | null] {
  return [
    placement.mode,
    placement.mode === 'position' ? placement.position : 0,
    placement.anchor?.id ?? null,
    placement.anchor?.type ?? null,
    placement.anchor?.name ?? null,
  ]
}

export function defaultFeaturePlacements(): Record<PlacementFeature, FeaturePlacement> {
  return Object.fromEntries(
    PLACEMENT_FEATURES.map((feature) => [feature, { ...DEFAULT_FEATURE_PLACEMENT }])
  ) as Record<PlacementFeature, FeaturePlacement>
}

export async function getFeaturePlacements(): Promise<Record<PlacementFeature, FeaturePlacement>> {
  const placements = defaultFeaturePlacements()
  const rows = await query<PlacementColumns & { feature: string; fallback_mode: string; fallback_position: number }>(
    `SELECT feature, mode, position, anchor_id, anchor_type, anchor_name, fallback_mode, fallback_position
     FROM home_sections_placements`
  )
  for (const row of rows.rows) {
    if (!isPlacementFeature(row.feature)) continue
    const placement = toPlacement(row)
    if (!placement) continue
    const fallbackMode = (FALLBACK_MODES as readonly string[]).includes(row.fallback_mode)
      ? (row.fallback_mode as FallbackMode)
      : DEFAULT_FEATURE_PLACEMENT.fallbackMode
    placements[row.feature] = {
      ...placement,
      fallbackMode,
      fallbackPosition: fallbackMode === 'position' ? row.fallback_position : 0,
    }
  }
  return placements
}

export async function saveFeaturePlacements(
  placements: Partial<Record<PlacementFeature, FeaturePlacement>>
): Promise<void> {
  for (const [feature, placement] of Object.entries(placements) as Array<[PlacementFeature, FeaturePlacement]>) {
    await query(
      `INSERT INTO home_sections_placements
         (feature, mode, position, anchor_id, anchor_type, anchor_name, fallback_mode, fallback_position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (feature) DO UPDATE SET
         mode = EXCLUDED.mode, position = EXCLUDED.position,
         anchor_id = EXCLUDED.anchor_id, anchor_type = EXCLUDED.anchor_type, anchor_name = EXCLUDED.anchor_name,
         fallback_mode = EXCLUDED.fallback_mode, fallback_position = EXCLUDED.fallback_position,
         updated_at = NOW()`,
      [
        feature,
        ...placementValues(placement),
        placement.fallbackMode,
        placement.fallbackMode === 'position' ? placement.fallbackPosition : 0,
      ]
    )
  }
}

/** Every viewer's overrides, keyed by user id. */
export async function getUserPlacements(userId?: string): Promise<Map<string, Map<PlacementFeature, Placement>>> {
  const rows = await query<PlacementColumns & { user_id: string; feature: string }>(
    `SELECT user_id, feature, mode, position, anchor_id, anchor_type, anchor_name
     FROM home_sections_user_placements
     ${userId ? 'WHERE user_id = $1' : ''}`,
    userId ? [userId] : []
  )
  const byUser = new Map<string, Map<PlacementFeature, Placement>>()
  for (const row of rows.rows) {
    if (!isPlacementFeature(row.feature)) continue
    const placement = toPlacement(row)
    if (!placement) continue
    const forUser = byUser.get(row.user_id) ?? new Map<PlacementFeature, Placement>()
    forUser.set(row.feature, placement)
    byUser.set(row.user_id, forUser)
  }
  return byUser
}

export async function setUserPlacement(userId: string, feature: PlacementFeature, placement: Placement): Promise<void> {
  await query(
    `INSERT INTO home_sections_user_placements (user_id, feature, mode, position, anchor_id, anchor_type, anchor_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id, feature) DO UPDATE SET
       mode = EXCLUDED.mode, position = EXCLUDED.position,
       anchor_id = EXCLUDED.anchor_id, anchor_type = EXCLUDED.anchor_type, anchor_name = EXCLUDED.anchor_name,
       updated_at = NOW()`,
    [userId, feature, ...placementValues(placement)]
  )
}

export async function clearUserPlacement(userId: string, feature: PlacementFeature): Promise<void> {
  await query(`DELETE FROM home_sections_user_placements WHERE user_id = $1 AND feature = $2`, [userId, feature])
}

/** The placement key last applied, per viewer per feature. */
export async function getAppliedPlacementKeys(userId?: string): Promise<Map<string, Map<PlacementFeature, string>>> {
  const rows = await query<{ user_id: string; feature: string; placement_key: string }>(
    `SELECT user_id, feature, placement_key FROM home_sections_applied_placements
     ${userId ? 'WHERE user_id = $1' : ''}`,
    userId ? [userId] : []
  )
  const byUser = new Map<string, Map<PlacementFeature, string>>()
  for (const row of rows.rows) {
    if (!isPlacementFeature(row.feature)) continue
    const forUser = byUser.get(row.user_id) ?? new Map<PlacementFeature, string>()
    forUser.set(row.feature, row.placement_key)
    byUser.set(row.user_id, forUser)
  }
  return byUser
}

export async function saveAppliedPlacementKeys(userId: string, keys: ReadonlyMap<PlacementFeature, string>): Promise<void> {
  for (const [feature, key] of keys) {
    await query(
      `INSERT INTO home_sections_applied_placements (user_id, feature, placement_key, applied_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, feature) DO UPDATE SET placement_key = EXCLUDED.placement_key, applied_at = NOW()`,
      [userId, feature, key]
    )
  }
}
