/**
 * Home row changes applied the moment they are made, for one viewer: a placement
 * they chose, and a playlist put on or taken off their home screen.
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
import { getHomeSectionsConfig } from './config.js'
import { diffMembership, isHomeSectionTarget, planViewerSections, sectionTagIds } from './plan.js'
import type { PlacementFeature } from './placement.js'
import { getAppliedPlacementKeys, getUserPlacements } from './placementStore.js'
import { loadHomePlaylists, type HomePlaylistSource } from './playlists.js'
import type { HomeSectionsConfig } from './settings.js'
import { loadViewerTags, loadViewers, playlistProviderIds, type ViewerRow } from './sources.js'
import { getHomeSectionsServerStatus } from './status.js'
import { managedTagsForViewer, placeViewerRows } from './viewerRows.js'

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
    if (!viewer || viewer.provider_disabled) return { applied: false, reason: 'not-a-target' }
    const tags = await ctx.provider.getTagsByPrefix(ctx.apiKey, MANAGED_TAG_PREFIX)
    return { applied: true, moved: await placeForViewer(ctx, viewer, tags, new Set()) }
  } catch (err) {
    return failed(err, { userId })
  }
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
