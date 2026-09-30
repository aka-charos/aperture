/**
 * Whether each kind of managed row reaches one viewer's home screen, and if
 * not, why. Pure — no database, no media server — and THE one answer: the sync
 * decides what to write from it, the instant path decides what to change, and
 * the viewer's settings page shows it. Three copies of this used to drift (the
 * sync, the placement settings and the playlist availability check each asked
 * their own version of "does this row reach them").
 *
 * Three layers, checked in this order, and the order is what a viewer is told:
 *
 * 1. **The server**: home rows are switched off entirely, or the account cannot
 *    receive this kind of row (no access here for a personal row; disabled on
 *    the media server for any row).
 * 2. **The operator**: the row kind is switched off for everyone, Top Picks
 *    itself is off, or the viewer cannot have recommendations of that kind.
 * 3. **The viewer**: their own switch. Absent means on — that is what every
 *    viewer got before switches existed (0188), and it must stay what a viewer
 *    who never opened the page gets.
 *
 * A viewer's own "off" is kept while a higher layer also says no, so the row
 * stays off for them when the operator turns it back on.
 */

import { isHomeSectionTarget, isTopPicksTarget } from './plan.js'
import { PLACEMENT_FEATURES, type PlacementFeature } from './placement.js'
import type { HomeSectionsConfig } from './settings.js'

/**
 * The row kinds a viewer switches on and off for themselves. Playlists are not
 * among them: each playlist is put on the home screen one at a time, which is
 * already a per-viewer switch.
 */
export const VIEWER_SWITCHABLE_FEATURES = [
  'top-picks-movies',
  'top-picks-series',
  'recs-movies',
  'recs-series',
  'friends',
] as const satisfies readonly PlacementFeature[]

export type SwitchableFeature = (typeof VIEWER_SWITCHABLE_FEATURES)[number]

export function isSwitchableFeature(value: unknown): value is SwitchableFeature {
  return typeof value === 'string' && (VIEWER_SWITCHABLE_FEATURES as readonly string[]).includes(value)
}

export type RowUnavailableReason =
  /** Home rows are switched off for the whole server. */
  | 'feature-off'
  /** The account cannot receive this kind of row: no access here, or disabled on the media server. */
  | 'no-access'
  /** The operator switched this kind of row off for everyone. */
  | 'admin-off'
  /** The Top Picks lists themselves are switched off. */
  | 'top-picks-off'
  /** The viewer's recommendations are switched off. */
  | 'recommendations-off'
  /** No library of this media type the viewer can open. */
  | 'no-library'

export type RowState =
  | { status: 'on' }
  /** The viewer switched it off. */
  | { status: 'off' }
  | { status: 'unavailable'; reason: RowUnavailableReason }

export interface RowStateViewer {
  isEnabled: boolean
  providerDisabled: boolean
  recommendationsEnabled: boolean
  hasMovies: boolean
  hasSeries: boolean
}

export type RowStateConfig = Pick<
  HomeSectionsConfig,
  | 'enabled'
  | 'topPicksEnabled'
  | 'topPicksWithoutAccess'
  | 'recommendationsEnabled'
  | 'friendsEnabled'
  | 'playlistsEnabled'
>

export interface RowStateInput {
  config: RowStateConfig
  /** Whether the Top Picks lists are switched on (`top_picks_config.is_enabled`). */
  topPicksListEnabled: boolean
  viewer: RowStateViewer
  /** The viewer's own switches. A kind absent here is on. */
  switches: ReadonlyMap<string, boolean> | undefined
}

const ON: RowState = { status: 'on' }
const unavailable = (reason: RowUnavailableReason): RowState => ({ status: 'unavailable', reason })

/** Whether the viewer switched a kind off. Only an explicit false does; absent is on. */
export function viewerSwitchedOff(switches: ReadonlyMap<string, boolean> | undefined, feature: string): boolean {
  return switches?.get(feature) === false
}

export function resolveRowStates(input: RowStateInput): Record<PlacementFeature, RowState> {
  const { config, viewer, switches } = input
  const who = { isEnabled: viewer.isEnabled, providerDisabled: viewer.providerDisabled }
  const personal = isHomeSectionTarget(who)
  const viewerLayer = (feature: SwitchableFeature): RowState =>
    viewerSwitchedOff(switches, feature) ? { status: 'off' } : ON

  const topPicks = (feature: 'top-picks-movies' | 'top-picks-series'): RowState => {
    if (!isTopPicksTarget(who, config.topPicksWithoutAccess)) return unavailable('no-access')
    if (!config.topPicksEnabled) return unavailable('admin-off')
    if (!input.topPicksListEnabled) return unavailable('top-picks-off')
    return viewerLayer(feature)
  }

  const recommendations = (feature: 'recs-movies' | 'recs-series'): RowState => {
    if (!personal) return unavailable('no-access')
    if (!config.recommendationsEnabled) return unavailable('admin-off')
    if (!viewer.recommendationsEnabled) return unavailable('recommendations-off')
    if (feature === 'recs-movies' ? !viewer.hasMovies : !viewer.hasSeries) return unavailable('no-library')
    return viewerLayer(feature)
  }

  const states = {} as Record<PlacementFeature, RowState>
  for (const feature of PLACEMENT_FEATURES) {
    if (!config.enabled) {
      states[feature] = unavailable('feature-off')
      continue
    }
    switch (feature) {
      case 'top-picks-movies':
      case 'top-picks-series':
        states[feature] = topPicks(feature)
        break
      case 'recs-movies':
      case 'recs-series':
        states[feature] = recommendations(feature)
        break
      case 'friends':
        states[feature] = !personal
          ? unavailable('no-access')
          : !config.friendsEnabled
            ? unavailable('admin-off')
            : viewerLayer('friends')
        break
      case 'playlists':
        states[feature] = !personal ? unavailable('no-access') : !config.playlistsEnabled ? unavailable('admin-off') : ON
        break
    }
  }
  return states
}
