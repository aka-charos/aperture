/**
 * A viewer's own Emby home screen settings, as one page: every kind of row
 * Aperture can add, whether it reaches them and why not, what it holds right
 * now, whether it is on their screen, where it goes — and a preview of their
 * whole home screen once the rows are applied.
 *
 * Everything the page shows is decided here and shipped as a decided value: the
 * row states come from `resolveRowStates` (the same answer the sync writes
 * from), the contents from the same sources the sync fills rows from, and the
 * preview from the same planner that places them. The bundle holds no rule.
 *
 * What a row holds is read on the viewer's behalf and filtered by THEIR library
 * scope: Top Picks is one list for the whole server, and a title from a library
 * they cannot open is hidden from them by Emby and must not be named here.
 */

import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { ownRowOptions, type HomeRowOption } from './anchors.js'
import { applyViewerRowsNow, type InstantOutcome } from './instant.js'
import { TOP_PICKS_TAGS, friendsTagName, recsTagNames, sectionTagIds } from './plan.js'
import {
  MAX_SECTION_POSITION,
  PLACEMENT_FEATURES,
  PLACEMENT_MODES,
  type FeaturePlacement,
  type Placement,
  type PlacementFeature,
  type PlacementMode,
} from './placement.js'
import { getAppliedPlacementKeys, getUserPlacements, setUserRowSwitch } from './placementStore.js'
import { loadPlaylistChoices, type PlaylistChoice } from './playlists.js'
import { projectHomeScreen, type ProjectedRow, type WantedRow } from './preview.js'
import { isSwitchableFeature, viewerSwitchedOff, type RowState } from './rowStates.js'
import type { HomeSectionSort, HomeSectionsConfig } from './settings.js'
import {
  describeRowTitles,
  friendRecommendedProviderIds,
  loadViewerTags,
  playlistProviderIds,
  recommendedProviderIds,
  topPicksProviderIds,
  type RowTitle,
  type ViewerRow,
} from './sources.js'
import { loadViewerRowStates } from './viewerState.js'

const logger = createChildLogger('home-sections-viewer')

/** Posters shown per row: enough to recognise what it is, not a second library page. */
const SAMPLE_SIZE = 12

/** Why the whole page has nothing to offer this viewer. */
export type HomeScreenUnavailable =
  /** The operator has not switched home rows on. */
  | 'feature-off'
  /** The media server is not Emby. */
  | 'unsupported'
  /** The account is not on this media server, or the server has disabled it. */
  | 'no-account'

export interface HomeRowContents {
  /** Titles in the row the viewer can open; null when it could not be read just now. */
  count: number | null
  sample: RowTitle[]
}

export interface UserHomeRow {
  feature: PlacementFeature
  /** The row's name on the Emby home screen; null for playlists, which carry their own names. */
  name: string | null
  state: RowState
  /** Whether the viewer has a switch for it. Playlists are chosen one at a time instead. */
  switchable: boolean
  /** The viewer's own switch; true until they turn it off. */
  enabled: boolean
  /** What the row holds for them; null when it cannot reach them at all. */
  contents: HomeRowContents | null
  /** Whether a row of this kind is on their Emby home screen right now. */
  onScreen: boolean
  defaultPlacement: FeaturePlacement
  override: Placement | null
}

export interface UserHomePlaylist {
  source: PlaylistChoice['source']
  id: string
  name: string
  outputType: PlaylistChoice['outputType']
  onHomeScreen: boolean
  /** False until it has been written to the media server (Generate), so there is nothing to show yet. */
  generated: boolean
  contents: HomeRowContents | null
  onScreen: boolean
}

export interface UserHomeScreen {
  available: boolean
  unavailableReason: HomeScreenUnavailable | null
  rows: UserHomeRow[]
  playlists: UserHomePlaylist[]
  /** Their home screen, top to bottom, once their rows are applied; null when Emby did not answer. */
  preview: ProjectedRow[] | null
  /** Their own rows, for an after/before placement. */
  anchors: HomeRowOption[]
  /** True when Emby did not answer, so `anchors` and `preview` are empty for that reason. */
  screenUnavailable: boolean
  /** How rows are ordered; a tag carries no order of its own. */
  sortBy: HomeSectionSort
  maxPosition: number
  modes: readonly PlacementMode[]
}

const unavailablePage = (reason: HomeScreenUnavailable, config: HomeSectionsConfig): UserHomeScreen => ({
  available: false,
  unavailableReason: reason,
  rows: [],
  playlists: [],
  preview: null,
  anchors: [],
  screenUnavailable: false,
  sortBy: config.sortBy,
  maxPosition: MAX_SECTION_POSITION,
  modes: PLACEMENT_MODES,
})

function rowName(feature: PlacementFeature, config: HomeSectionsConfig): string | null {
  switch (feature) {
    case 'top-picks-movies':
      return config.topPicksMoviesName
    case 'top-picks-series':
      return config.topPicksSeriesName
    case 'recs-movies':
      return config.recommendationsMoviesName
    case 'recs-series':
      return config.recommendationsSeriesName
    case 'friends':
      return config.friendsName
    case 'playlists':
      return null
  }
}

async function contentsOf(
  read: () => Promise<string[] | null>,
  viewer: ViewerRow,
  scope: string
): Promise<HomeRowContents> {
  try {
    const ids = await read()
    if (ids === null) return { count: null, sample: [] }
    return await describeRowTitles(ids, viewer.scope, SAMPLE_SIZE)
  } catch (err) {
    logger.warn({ err, scope, userId: viewer.id }, 'Could not read what a home row holds')
    return { count: null, sample: [] }
  }
}

interface EmbyView {
  provider: MediaServerProvider
  apiKey: string
  sections: ContentSection[]
  tagIdByName: Map<string, string>
}

async function readEmby(viewer: ViewerRow): Promise<EmbyView | null> {
  try {
    const provider = await getMediaServerProvider()
    const apiKey = await getMediaServerApiKey()
    if (!apiKey) return null
    const [tags, sections] = await Promise.all([
      provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX),
      provider.getHomeSections(apiKey, viewer.provider_user_id),
    ])
    const tagIdByName = new Map(
      tags.flatMap((tag) => (tag.id ? [[tag.name.toLowerCase(), tag.id] as [string, string]] : []))
    )
    return { provider, apiKey, sections, tagIdByName }
  } catch (err) {
    logger.warn({ err, userId: viewer.id }, 'Could not read a home screen from Emby')
    return null
  }
}

export async function getUserHomeScreen(userId: string): Promise<UserHomeScreen> {
  const { config, serverType, viewer, switches, states } = await loadViewerRowStates(userId)
  if (!config.enabled) return unavailablePage('feature-off', config)
  if (serverType !== 'emby') return unavailablePage('unsupported', config)
  if (!viewer || !states || viewer.provider_disabled) return unavailablePage('no-account', config)

  const [emby, viewerTags, choices, overridesByUser, appliedByUser] = await Promise.all([
    readEmby(viewer),
    loadViewerTags(),
    loadPlaylistChoices(viewer.id),
    getUserPlacements(viewer.id),
    getAppliedPlacementKeys(viewer.id),
  ])
  const viewerTag = viewerTags.get(viewer.id)
  const overrides = overridesByUser.get(viewer.id)

  // The tag each kind of row queries for this viewer, where it has one.
  const tagNameOf = (feature: PlacementFeature): string | undefined => {
    if (feature === 'top-picks-movies' || feature === 'top-picks-series') return TOP_PICKS_TAGS[feature]
    if (!viewerTag) return undefined
    if (feature === 'recs-movies') return recsTagNames(viewerTag).movies
    if (feature === 'recs-series') return recsTagNames(viewerTag).series
    if (feature === 'friends') return friendsTagName(viewerTag)
    return undefined
  }
  const tagIdOf = (tagName: string | null | undefined): string | undefined =>
    tagName ? emby?.tagIdByName.get(tagName.toLowerCase()) : undefined
  const onScreen = (tagId: string | undefined): boolean =>
    !!tagId && !!emby?.sections.some((section) => sectionTagIds(section).includes(tagId))

  const readContents = (feature: PlacementFeature): Promise<HomeRowContents> | null => {
    if (states[feature].status === 'unavailable') return null
    switch (feature) {
      case 'top-picks-movies':
      case 'top-picks-series': {
        // Shared by every viewer and filled by the sync: what the tag holds is what the row shows.
        // No tag means nobody wanted it last sync, and switching it on fills it with the list itself.
        const tagName = TOP_PICKS_TAGS[feature]
        return contentsOf(
          async () => {
            if (!emby) return null
            return tagIdOf(tagName)
              ? emby.provider.getItemIdsWithTag(emby.apiKey, tagName)
              : topPicksProviderIds(feature)
          },
          viewer,
          feature
        )
      }
      case 'recs-movies':
        return contentsOf(() => recommendedProviderIds(viewer, 'movie', config.recommendationsLimit), viewer, feature)
      case 'recs-series':
        return contentsOf(() => recommendedProviderIds(viewer, 'series', config.recommendationsLimit), viewer, feature)
      case 'friends':
        return contentsOf(() => friendRecommendedProviderIds(viewer), viewer, feature)
      case 'playlists':
        return null
    }
  }

  const rows: UserHomeRow[] = await Promise.all(
    PLACEMENT_FEATURES.map(async (feature) => ({
      feature,
      name: rowName(feature, config),
      state: states[feature],
      switchable: isSwitchableFeature(feature),
      enabled: isSwitchableFeature(feature) ? !viewerSwitchedOff(switches, feature) : true,
      contents: (await readContents(feature)) ?? null,
      onScreen: onScreen(tagIdOf(tagNameOf(feature))),
      defaultPlacement: config.placements[feature],
      override: overrides?.get(feature) ?? null,
    }))
  )

  const playlistsReachable = states.playlists.status !== 'unavailable'
  const playlists: UserHomePlaylist[] = await Promise.all(
    choices.map(async (choice) => {
      const generated = !!choice.containerId
      return {
        source: choice.source,
        id: choice.id,
        name: choice.name,
        outputType: choice.outputType,
        onHomeScreen: choice.onHomeScreen,
        generated,
        contents:
          playlistsReachable && generated
            ? await contentsOf(
                async () =>
                  emby
                    ? playlistProviderIds(emby.provider, emby.apiKey, { ...choice, tagName: choice.tagName ?? '' })
                    : null,
                viewer,
                `playlist:${choice.id}`
              )
            : null,
        onScreen: onScreen(tagIdOf(choice.tagName)),
      }
    })
  )

  // A row will be there once applied when it is on and holds something — or
  // when what it holds could not be read and it is there already.
  const willShow = (state: RowState, contents: HomeRowContents | null, present: boolean) =>
    state.status === 'on' && (contents?.count != null ? contents.count > 0 : present)
  const wanted: WantedRow[] = []
  for (const row of rows) {
    if (row.feature === 'playlists' || !willShow(row.state, row.contents, row.onScreen)) continue
    wanted.push({
      key: tagIdOf(tagNameOf(row.feature)) ?? `new:${row.feature}`,
      feature: row.feature,
      name: row.name ?? row.feature,
    })
  }
  for (const playlist of playlists) {
    if (!playlist.onHomeScreen || !willShow(states.playlists, playlist.contents, playlist.onScreen)) continue
    const choice = choices.find((candidate) => candidate.id === playlist.id && candidate.source === playlist.source)
    wanted.push({ key: tagIdOf(choice?.tagName) ?? `new:playlist:${playlist.id}`, feature: 'playlists', name: playlist.name })
  }

  let preview: ProjectedRow[] | null = null
  if (emby) {
    try {
      preview = projectHomeScreen({
        sections: emby.sections,
        managedTagIds: new Set(emby.tagIdByName.values()),
        wanted,
        defaults: config.placements,
        overrides,
        applied: appliedByUser.get(viewer.id),
      })
    } catch (err) {
      logger.warn({ err, userId: viewer.id }, 'Could not project a home screen')
    }
  }

  return {
    available: true,
    unavailableReason: null,
    rows,
    playlists,
    preview,
    anchors: emby ? ownRowOptions(emby.sections, new Set(emby.tagIdByName.values())) : [],
    screenUnavailable: !emby,
    sortBy: config.sortBy,
    maxPosition: MAX_SECTION_POSITION,
    modes: PLACEMENT_MODES,
  }
}

export type SaveRowSwitchResult =
  | { ok: true; enabled: boolean; outcome: InstantOutcome }
  | { ok: false; status: 404; error: string }

/**
 * A viewer switches one kind of row on or off for themselves, applied to their
 * home screen at once. Storing it while the operator has the row switched off
 * is allowed — it is the viewer's preference for when it comes back — but the
 * page never offers it then.
 */
export async function saveUserRowSwitch(
  userId: string,
  feature: string,
  enabled: boolean
): Promise<SaveRowSwitchResult> {
  if (!isSwitchableFeature(feature)) return { ok: false, status: 404, error: 'Unknown row' }
  const { config, serverType, viewer } = await loadViewerRowStates(userId)
  if (!config.enabled || serverType !== 'emby' || !viewer || viewer.provider_disabled) {
    return { ok: false, status: 404, error: 'Home screen rows are not available' }
  }
  await setUserRowSwitch(userId, feature, enabled)
  return { ok: true, enabled, outcome: await applyViewerRowsNow(userId) }
}
