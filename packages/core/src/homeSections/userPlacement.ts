/**
 * A viewer's own placements for the rows that reach their home screen.
 *
 * The admin sets a default per feature; a viewer may override any feature that
 * can reach them (rowStates.ts), anchoring to a row on their OWN home screen.
 * Saving applies at once for that viewer. An override whose anchor later
 * disappears from their screen falls back to the admin default (placementChain).
 * The page that offers this is userHomeScreen.ts.
 */

import { listOwnHomeRows, type HomeRowOption } from './anchors.js'
import { applyPlacementForUser, type InstantOutcome } from './instant.js'
import { isAnchorMode, sanitizePlacement, type Placement, type PlacementFeature } from './placement.js'
import { clearUserPlacement, setUserPlacement } from './placementStore.js'
import { loadViewerRowStates } from './viewerState.js'

export type SaveUserPlacementResult =
  | { ok: true; placement: Placement | null; outcome: InstantOutcome }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Save a viewer's override and apply it. The anchor's type and name are taken
 * from the viewer's own home screen, never from the request: what the row IS is
 * the server's to say.
 */
export async function saveUserPlacement(
  userId: string,
  feature: PlacementFeature,
  body: unknown
): Promise<SaveUserPlacementResult> {
  const { config, serverType, viewer, states } = await loadViewerRowStates(userId)
  if (!config.enabled || serverType !== 'emby' || !viewer || !states || states[feature].status === 'unavailable') {
    return { ok: false, status: 404, error: 'That row does not reach your home screen' }
  }
  const { placement, errors } = sanitizePlacement(body, 'placement')
  if (!placement) return { ok: false, status: 400, error: errors.join('; ') }

  let stored = placement
  if (isAnchorMode(placement.mode)) {
    let rows: HomeRowOption[] = []
    try {
      rows = await listOwnHomeRows(viewer.provider_user_id)
    } catch {
      return { ok: false, status: 400, error: 'Emby did not return your home screen rows' }
    }
    const row = rows.find((candidate) => candidate.id === placement.anchor?.id)
    if (!row) return { ok: false, status: 400, error: 'That row is not on your home screen' }
    stored = { ...placement, anchor: { id: row.id, type: row.type, name: row.name } }
  }

  await setUserPlacement(userId, feature, stored)
  return { ok: true, placement: stored, outcome: await applyPlacementForUser(userId) }
}

/** Go back to the admin default for a feature, and apply it. */
export async function resetUserPlacement(userId: string, feature: PlacementFeature): Promise<SaveUserPlacementResult> {
  await clearUserPlacement(userId, feature)
  return { ok: true, placement: null, outcome: await applyPlacementForUser(userId) }
}
