/**
 * A viewer's own placements for the rows that reach their home screen.
 *
 * The admin sets a default per feature; a viewer may override any feature that
 * actually reaches them, anchoring to a row on their OWN home screen. Saving
 * applies at once for that viewer. An override whose anchor later disappears
 * from their screen falls back to the admin default (placementChain).
 */

import { queryOne } from '../lib/db.js'
import { getMediaServerConfig } from '../settings/systemSettings.js'
import { getTopPicksConfig } from '../topPicks/config.js'
import { listOwnHomeRows, type HomeRowOption } from './anchors.js'
import { getHomeSectionsConfig } from './config.js'
import { applyPlacementForUser, type InstantOutcome } from './instant.js'
import {
  MAX_SECTION_POSITION,
  PLACEMENT_MODES,
  isAnchorMode,
  sanitizePlacement,
  type FeaturePlacement,
  type Placement,
  type PlacementFeature,
  type PlacementMode,
} from './placement.js'
import { clearUserPlacement, getUserPlacements, setUserPlacement } from './placementStore.js'
import { loadHomePlaylists } from './playlists.js'
import { isTopPicksTarget } from './plan.js'
import { getLibraryScopeForUser } from '../lib/libraryScope.js'

export interface UserHomeScreenFeature {
  feature: PlacementFeature
  /** The row's name for a single-row feature; null for playlists, which carry their own names. */
  rowName: string | null
  defaultPlacement: FeaturePlacement
  override: Placement | null
}

export interface UserHomeScreenSettings {
  available: boolean
  features: UserHomeScreenFeature[]
  /** The viewer's own rows, in their order: what an override can anchor to. */
  rows: HomeRowOption[]
  /** True when Emby did not answer, so `rows` is empty for that reason and not because there are none. */
  rowsUnavailable: boolean
  maxPosition: number
  /** The placement vocabulary, so the page never holds a copy of it. */
  modes: readonly PlacementMode[]
}

const UNAVAILABLE: UserHomeScreenSettings = {
  available: false,
  features: [],
  rows: [],
  rowsUnavailable: false,
  maxPosition: MAX_SECTION_POSITION,
  modes: PLACEMENT_MODES,
}

export async function getUserHomeScreenSettings(userId: string): Promise<UserHomeScreenSettings> {
  const [config, server, user] = await Promise.all([
    getHomeSectionsConfig(),
    getMediaServerConfig(),
    queryOne<{
      provider_user_id: string | null
      is_enabled: boolean
      provider_disabled: boolean
      recommendations_enabled: boolean
    }>(
      `SELECT provider_user_id, is_enabled, provider_disabled, recommendations_enabled FROM users WHERE id = $1`,
      [userId]
    ),
  ])
  if (!config.enabled || server.type !== 'emby' || !user?.provider_user_id || user.provider_disabled) {
    return UNAVAILABLE
  }

  const target = user.is_enabled === true
  const reaching: Array<[PlacementFeature, string | null]> = []
  const topPicksTarget = isTopPicksTarget(
    { isEnabled: user.is_enabled === true, providerDisabled: user.provider_disabled },
    config.topPicksWithoutAccess
  )
  if (topPicksTarget && config.topPicksEnabled && (await getTopPicksConfig()).isEnabled) {
    reaching.push(['top-picks-movies', config.topPicksMoviesName], ['top-picks-series', config.topPicksSeriesName])
  }
  if (target && config.recommendationsEnabled && user.recommendations_enabled) {
    const scope = await getLibraryScopeForUser(userId)
    if (scope.hasMovies) reaching.push(['recs-movies', config.recommendationsMoviesName])
    if (scope.hasSeries) reaching.push(['recs-series', config.recommendationsSeriesName])
  }
  if (target && config.playlistsEnabled && (await loadHomePlaylists()).some((p) => p.ownerId === userId)) {
    reaching.push(['playlists', null])
  }

  const overrides = (await getUserPlacements(userId)).get(userId)
  const features = reaching.map(([feature, rowName]) => ({
    feature,
    rowName,
    defaultPlacement: config.placements[feature],
    override: overrides?.get(feature) ?? null,
  }))

  let rows: HomeRowOption[] = []
  let rowsUnavailable = false
  if (features.length > 0) {
    try {
      rows = await listOwnHomeRows(user.provider_user_id)
    } catch {
      rowsUnavailable = true
    }
  }

  return { available: true, features, rows, rowsUnavailable, maxPosition: MAX_SECTION_POSITION, modes: PLACEMENT_MODES }
}

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
  const settings = await getUserHomeScreenSettings(userId)
  if (!settings.available || !settings.features.some((f) => f.feature === feature)) {
    return { ok: false, status: 404, error: 'That row does not reach your home screen' }
  }
  const { placement, errors } = sanitizePlacement(body, 'placement')
  if (!placement) return { ok: false, status: 400, error: errors.join('; ') }

  let stored = placement
  if (isAnchorMode(placement.mode)) {
    const row = settings.rows.find((candidate) => candidate.id === placement.anchor?.id)
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
