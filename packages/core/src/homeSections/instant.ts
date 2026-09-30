/**
 * Home row changes applied the moment they are made, for one viewer: a row they
 * switched on or off, a placement they chose, a playlist put on or taken off
 * their home screen, and a title a connection just sent them or they dismissed.
 *
 * The nightly sync still reconciles everything; these only spare the wait. So
 * each returns an outcome instead of throwing — the setting that triggered it is
 * already saved, and a failure here is repaired by the next sync.
 */

import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { isEmbyNotFoundError } from '../media/emby/fetchHelpers.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { MediaServerTag } from '../media/types.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { reconcileViewerScreen, viewerDesiredRows, writeTagMembership, type TagPlan } from './apply.js'
import { getHomeSectionsConfig } from './config.js'
import {
  TOP_PICKS_TAGS,
  diffMembership,
  friendsTagName,
  isHomeSectionTarget,
  mayReceiveHomeRows,
  planViewerSections,
  recsTagNames,
  sectionTagIds,
} from './plan.js'
import type { PlacementFeature } from './placement.js'
import { getAppliedPlacementKeys, getUserPlacements } from './placementStore.js'
import { loadHomePlaylists, type HomePlaylistSource } from './playlists.js'
import type { HomeSectionsConfig } from './settings.js'
import {
  friendRecommendedProviderIds,
  loadViewerTags,
  loadViewers,
  mintViewerTag,
  playlistProviderIds,
  recommendedProviderIds,
  topPicksProviderIds,
  type ViewerRow,
} from './sources.js'
import { getHomeSectionsServerStatus } from './status.js'
import { managedTagsForViewer, placeViewerRows } from './viewerRows.js'
import { loadViewerRowStates } from './viewerState.js'

const logger = createChildLogger('home-sections-instant')

export type InstantOutcome =
  | { applied: true; moved: number }
  | {
      applied: false
      reason: 'off' | 'unsupported' | 'not-a-target' | 'nothing-to-show' | 'failed'
      message?: string
    }

interface ServerContext {
  config: HomeSectionsConfig
  provider: MediaServerProvider
  apiKey: string
}

async function serverContext(requireEnabled: boolean): Promise<ServerContext | InstantOutcome> {
  const config = await getHomeSectionsConfig()
  if (requireEnabled && !config.enabled) return { applied: false, reason: 'off' }
  const status = await getHomeSectionsServerStatus()
  if (!status.supported) return { applied: false, reason: 'unsupported' }
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()
  if (!apiKey) return { applied: false, reason: 'unsupported' }
  return { config, provider, apiKey }
}

function failed(err: unknown, context: Record<string, unknown>): InstantOutcome {
  const message = err instanceof Error ? err.message : String(err)
  logger.warn({ err, ...context }, 'Instant home row change failed; the next sync will retry')
  return { applied: false, reason: 'failed', message }
}

function tagIdsByName(tags: readonly MediaServerTag[]): Map<string, string> {
  return new Map(tags.flatMap((tag) => (tag.id ? [[tag.name.toLowerCase(), tag.id] as [string, string]] : [])))
}

async function placeForViewer(
  ctx: ServerContext,
  viewer: ViewerRow,
  tags: readonly MediaServerTag[],
  force: ReadonlySet<PlacementFeature>
): Promise<number> {
  const [viewerTags, playlists, sections, overrides, applied] = await Promise.all([
    loadViewerTags(),
    loadHomePlaylists(),
    ctx.provider.getHomeSections(ctx.apiKey, viewer.provider_user_id),
    getUserPlacements(viewer.id),
    getAppliedPlacementKeys(viewer.id),
  ])
  const managed = managedTagsForViewer({
    viewerId: viewer.id,
    viewerTagName: viewerTags.get(viewer.id),
    playlists,
    tagIdByName: tagIdsByName(tags),
  })
  const { moved } = await placeViewerRows({
    provider: ctx.provider,
    apiKey: ctx.apiKey,
    userId: viewer.id,
    providerUserId: viewer.provider_user_id,
    sections,
    managed,
    defaults: ctx.config.placements,
    overrides: overrides.get(viewer.id),
    applied: applied.get(viewer.id),
    force,
  })
  return moved
}

/**
 * Put one viewer's rows where their placements now say. Only rows whose
 * placement changed move — the same rule as the nightly sync.
 */
export async function applyPlacementForUser(userId: string): Promise<InstantOutcome> {
  try {
    const ctx = await serverContext(true)
    if ('applied' in ctx) return ctx
    const [viewer] = await loadViewers(ctx.provider.type, userId)
    if (
      !viewer ||
      !mayReceiveHomeRows(
        { isEnabled: viewer.is_enabled, providerDisabled: viewer.provider_disabled },
        ctx.config.topPicksWithoutAccess
      )
    ) {
      return { applied: false, reason: 'not-a-target' }
    }
    const tags = await ctx.provider.getTagsByPrefix(ctx.apiKey, MANAGED_TAG_PREFIX)
    return { applied: true, moved: await placeForViewer(ctx, viewer, tags, new Set()) }
  } catch (err) {
    return failed(err, { userId })
  }
}

/**
 * Bring one viewer's whole home screen in line with their row states now: the
 * same three steps as the nightly sync (apply.ts), for one viewer. Their own
 * tags — recommendations, friends, their playlists — are rewritten. The Top
 * Picks tags are shared by every viewer and only READ here, so a row switched
 * on shows whatever the last sync put in them — unless the last sync emptied
 * one because nobody wanted it, in which case it is filled now with the list
 * the sync would write, rather than leaving the row off until tonight.
 *
 * `whenOn` skips the whole write unless that row reaches the viewer — for a
 * change that can only affect one row (a title a connection sent them).
 */
export async function applyViewerRowsNow(
  userId: string,
  options: { whenOn?: PlacementFeature } = {}
): Promise<InstantOutcome> {
  try {
    const ctx = await serverContext(true)
    if ('applied' in ctx) return ctx
    const { viewer, states, config } = await loadViewerRowStates(userId)
    if (!viewer || !states || viewer.provider_disabled) return { applied: false, reason: 'not-a-target' }
    if (options.whenOn && states[options.whenOn].status !== 'on') return { applied: false, reason: 'off' }

    const { provider, apiKey } = ctx
    const onError = (scope: string, err: unknown) => {
      throw err instanceof Error ? err : new Error(`${scope}: ${String(err)}`)
    }
    const on = (feature: PlacementFeature) => states[feature].status === 'on'

    const tagsBefore = await provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX)
    const idBefore = tagIdsByName(tagsBefore)
    const tagPlans = new Map<string, TagPlan>()
    const planTag = (name: string, ids: string[] | null) => tagPlans.set(name.toLowerCase(), { name, ids })

    const writes: TagPlan[] = []
    for (const kind of ['top-picks-movies', 'top-picks-series'] as const) {
      if (!on(kind)) continue
      const name = TOP_PICKS_TAGS[kind]
      if (idBefore.has(name.toLowerCase())) planTag(name, await provider.getItemIdsWithTag(apiKey, name))
      else writes.push({ name, ids: await topPicksProviderIds(kind) })
    }

    const movies = on('recs-movies') ? await recommendedProviderIds(viewer, 'movie', config.recommendationsLimit) : []
    const series = on('recs-series') ? await recommendedProviderIds(viewer, 'series', config.recommendationsLimit) : []
    const friends = on('friends') ? await friendRecommendedProviderIds(viewer) : []
    let viewerTag = (await loadViewerTags()).get(viewer.id)
    if (!viewerTag && (movies.length > 0 || series.length > 0 || friends.length > 0)) {
      viewerTag = await mintViewerTag(viewer.id)
    }
    if (viewerTag) {
      const names = recsTagNames(viewerTag)
      writes.push(
        { name: names.movies, ids: movies },
        { name: names.series, ids: series },
        { name: friendsTagName(viewerTag), ids: friends }
      )
    }
    const playlists = (await loadHomePlaylists()).filter((playlist) => playlist.ownerId === viewer.id)
    for (const playlist of playlists) {
      writes.push({
        name: playlist.tagName,
        ids: on('playlists') ? await playlistProviderIds(provider, apiKey, playlist) : [],
      })
    }

    for (const plan of writes) {
      planTag(plan.name, plan.ids)
      await writeTagMembership({
        provider,
        apiKey,
        name: plan.name,
        ids: plan.ids ?? [],
        existingId: idBefore.get(plan.name.toLowerCase()),
        onItemError: onError,
      })
    }

    const tagsAfter = await provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX)
    const rows = viewerDesiredRows({
      viewerId: viewer.id,
      states,
      names: config,
      sortBy: config.sortBy,
      viewerTagName: viewerTag,
      playlists,
      tagPlans,
      tagIdByName: tagIdsByName(tagsAfter),
      idBefore,
    })
    const [sections, overrides, applied] = await Promise.all([
      provider.getHomeSections(apiKey, viewer.provider_user_id),
      getUserPlacements(viewer.id),
      getAppliedPlacementKeys(viewer.id),
    ])
    const written = await reconcileViewerScreen({
      provider,
      apiKey,
      userId: viewer.id,
      providerUserId: viewer.provider_user_id,
      sections,
      managedTagIds: new Set([...idBefore.values(), ...tagIdsByName(tagsAfter).values()]),
      rows,
      defaults: config.placements,
      overrides: overrides.get(viewer.id),
      applied: applied.get(viewer.id),
    })
    return { applied: true, moved: written.moved }
  } catch (err) {
    return failed(err, { userId })
  }
}

/**
 * Refresh one row kind for several viewers without making anyone wait: for a
 * change made on someone else's page (a connection sent them a title) or one
 * that should not hold up a click (they dismissed one). Viewers whose row is
 * not on are skipped before any call to the media server. Each runs in turn,
 * never together — they share tags and the media server.
 */
export function refreshViewerRowsSoon(userIds: readonly string[], feature: PlacementFeature): void {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return
  void (async () => {
    for (const userId of unique) {
      const outcome = await applyViewerRowsNow(userId, { whenOn: feature })
      if (!outcome.applied && outcome.reason === 'failed') {
        logger.debug({ userId, message: outcome.message }, 'Background home row refresh did not apply')
      }
    }
  })()
}

/**
 * A playlist just put on its owner's home screen: tag its items, create the
 * row, and place the owner's playlist rows. The playlist must already hold its
 * home tag (the route stores it first).
 */
export async function showPlaylistRowNow(source: HomePlaylistSource, playlistId: string): Promise<InstantOutcome> {
  try {
    const ctx = await serverContext(true)
    if ('applied' in ctx) return ctx
    if (!ctx.config.playlistsEnabled) return { applied: false, reason: 'off' }

    const playlist = (await loadHomePlaylists()).find((p) => p.source === source && p.id === playlistId)
    if (!playlist) return { applied: false, reason: 'nothing-to-show' }
    const [viewer] = await loadViewers(ctx.provider.type, playlist.ownerId)
    if (!viewer || !isHomeSectionTarget({ isEnabled: viewer.is_enabled, providerDisabled: viewer.provider_disabled })) {
      return { applied: false, reason: 'not-a-target' }
    }

    const itemIds = await playlistProviderIds(ctx.provider, ctx.apiKey, playlist)
    if (itemIds.length === 0) return { applied: false, reason: 'nothing-to-show' }

    const tagsBefore = await ctx.provider.getTagsByPrefix(ctx.apiKey, MANAGED_TAG_PREFIX)
    const existing = tagsBefore.find((tag) => tag.name.toLowerCase() === playlist.tagName.toLowerCase())
    const current = existing ? await ctx.provider.getItemIdsWithTag(ctx.apiKey, playlist.tagName) : []
    const { add, remove } = diffMembership(current, itemIds)
    for (const itemId of add) {
      await ctx.provider.addItemTag(ctx.apiKey, itemId, { name: playlist.tagName, id: existing?.id })
    }
    for (const itemId of remove) {
      await ctx.provider.removeItemTag(ctx.apiKey, itemId, { name: playlist.tagName, id: existing?.id })
    }

    const tags = existing?.id ? tagsBefore : await ctx.provider.getTagsByPrefix(ctx.apiKey, MANAGED_TAG_PREFIX)
    const tagId = tagIdsByName(tags).get(playlist.tagName.toLowerCase())
    if (!tagId) return { applied: false, reason: 'failed', message: 'The tag was applied but Emby reports no id for it' }

    const sections = await ctx.provider.getHomeSections(ctx.apiKey, viewer.provider_user_id)
    // Only this playlist's tag is recognised, so no other row on the screen is touched.
    const plan = planViewerSections({
      existing: sections,
      managedTagIds: new Set([tagId]),
      desired: [
        { kind: 'playlist', tagId, name: playlist.name, itemTypes: ['Movie', 'Series'], sortBy: ctx.config.sortBy },
      ],
      preserveTagIds: new Set(),
    })
    if (plan.deletes.length > 0) {
      await ctx.provider.deleteHomeSections(ctx.apiKey, viewer.provider_user_id, plan.deletes)
    }
    for (const section of [...plan.updates, ...plan.creates]) {
      await ctx.provider.saveHomeSection(ctx.apiKey, viewer.provider_user_id, section)
    }

    const force = new Set<PlacementFeature>(plan.creates.length > 0 ? ['playlists'] : [])
    return { applied: true, moved: await placeForViewer(ctx, viewer, tags, force) }
  } catch (err) {
    return failed(err, { source, playlistId })
  }
}

/**
 * A playlist just taken off its owner's home screen: remove the row and strip
 * the tag it used from every item. Works with the feature switched off too —
 * taking something off must never wait on a setting.
 */
export async function hidePlaylistRowNow(ownerId: string, tagName: string): Promise<InstantOutcome> {
  try {
    const ctx = await serverContext(false)
    if ('applied' in ctx) return ctx

    const tags = await ctx.provider.getTagsByPrefix(ctx.apiKey, MANAGED_TAG_PREFIX)
    const tag = tags.find((candidate) => candidate.name.toLowerCase() === tagName.toLowerCase())
    if (!tag?.id) return { applied: true, moved: 0 }
    const tagId = tag.id

    const [viewer] = await loadViewers(ctx.provider.type, ownerId)
    if (viewer) {
      try {
        const sections = await ctx.provider.getHomeSections(ctx.apiKey, viewer.provider_user_id)
        const ids = sections
          .filter((section) => section.Id && sectionTagIds(section).includes(tagId))
          .map((section) => String(section.Id))
        if (ids.length > 0) await ctx.provider.deleteHomeSections(ctx.apiKey, viewer.provider_user_id, ids)
      } catch (err) {
        if (!isEmbyNotFoundError(err)) throw err
      }
    }

    for (const itemId of await ctx.provider.getItemIdsWithTag(ctx.apiKey, tag.name)) {
      await ctx.provider.removeItemTag(ctx.apiKey, itemId, { name: tag.name, id: tagId })
    }
    return { applied: true, moved: 0 }
  } catch (err) {
    return failed(err, { ownerId, tagName })
  }
}
