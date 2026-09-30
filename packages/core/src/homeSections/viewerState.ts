/**
 * One viewer's row states, read from the database: the config, the viewer as
 * the rules see them, their own switches and whether Top Picks is on, run
 * through `resolveRowStates`. Every one-viewer path asks this — the settings
 * page, the instant path, the playlist availability check, a placement save —
 * so none of them holds its own copy of who gets which row.
 */

import { getMediaServerConfig } from '../settings/systemSettings.js'
import { getTopPicksConfig } from '../topPicks/config.js'
import { getHomeSectionsConfig } from './config.js'
import type { PlacementFeature } from './placement.js'
import { getUserRowSwitches } from './placementStore.js'
import { resolveRowStates, type RowState } from './rowStates.js'
import type { HomeSectionsConfig } from './settings.js'
import { loadViewers, rowStateViewer, type ViewerRow } from './sources.js'

export interface ViewerRowStates {
  config: HomeSectionsConfig
  /** The media server type configured now; rows exist on Emby only. */
  serverType: string | null
  /** Null when the account is not on this media server. */
  viewer: ViewerRow | null
  /** The viewer's own switches, as stored. */
  switches: ReadonlyMap<string, boolean>
  /** Null when there is no viewer to decide for. */
  states: Record<PlacementFeature, RowState> | null
}

export async function loadViewerRowStates(userId: string): Promise<ViewerRowStates> {
  const [config, server] = await Promise.all([getHomeSectionsConfig(), getMediaServerConfig()])
  const serverType = server.type ?? null
  if (!serverType) return { config, serverType, viewer: null, switches: new Map(), states: null }

  const [[viewer], switchesByUser, topPicks] = await Promise.all([
    loadViewers(serverType, userId),
    getUserRowSwitches(userId),
    getTopPicksConfig(),
  ])
  const switches = switchesByUser.get(userId) ?? new Map<string, boolean>()
  if (!viewer) return { config, serverType, viewer: null, switches, states: null }

  const states = resolveRowStates({
    config,
    topPicksListEnabled: topPicks.isEnabled,
    viewer: rowStateViewer(viewer),
    switches,
  })
  return { config, serverType, viewer, switches, states }
}
