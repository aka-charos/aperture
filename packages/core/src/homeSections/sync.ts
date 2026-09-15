/**
 * Sync managed rows onto every viewer's Emby home screen (job `sync-home-sections`).
 *
 * One run is three passes, in this order because each needs the one before:
 *
 * 1. Work out what every managed tag should hold: the Top Picks lists, each
 *    enabled viewer's newest completed picks (a movies tag and a series tag),
 *    and every generated playlist an owner put on their home screen. A tag this
 *    run cannot account for — a deleted viewer's, a switched-off row's, 0173's
 *    mixed recommendations tag — should hold nothing. Top Picks goes to every
 *    account the server has not disabled; the personal rows only to viewers
 *    enabled in Aperture (plan.ts).
 * 2. Tag and untag the ORIGINAL library items to match. A section filters by tag
 *    id and a tag has an id only once an item carries it, so ids are read after.
 * 3. Read each viewer's sections back and reconcile them (plan.ts): create,
 *    update and remove, then place the rows whose placement changed or that were
 *    just created (placement.ts, viewerRows.ts).
 *
 * Switching the feature off is not a separate path: with it off every tag
 * should hold nothing and nobody should have a row, so the same run removes
 * everything an earlier run wrote.
 *
 * Failure is never read as emptiness. When a row's contents cannot be worked
 * out, its tag is not touched and its sections are preserved as they are.
 */

import { randomUUID } from 'crypto'
import { createChildLogger } from '../lib/logger.js'
import {
  addLog,
  completeJob,
  createJobProgress,
  failJob,
  isJobCancelled,
  setJobStep,
  updateJobProgress,
} from '../jobs/progress.js'
import { getMediaServerProvider } from '../media/index.js'
import { isEmbyNotFoundError } from '../media/emby/fetchHelpers.js'
import { MANAGED_TAG_PREFIX } from '../media/managedTags.js'
import type { MediaServerProvider } from '../media/MediaServerProvider.js'
import type { ContentSection } from '../media/types.js'
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { getTopPicksConfig } from '../topPicks/config.js'
import { getHomeSectionsConfig } from './config.js'
import {
  TOP_PICKS_TAGS,
  diffMembership,
  featureOfKind,
  isHomeSectionTarget,
  isTopPicksTarget,
  planViewerSections,
  recsTagNames,
  sectionTagIds,
  type DesiredRow,
  type ManagedRowKind,
} from './plan.js'
import type { PlacementFeature } from './placement.js'
import { getAppliedPlacementKeys, getUserPlacements } from './placementStore.js'
import { loadHomePlaylists } from './playlists.js'
import {
  accountIsGone,
  loadViewerTags,
  loadViewers,
  mintViewerTag,
  playlistProviderIds,
  recommendedProviderIds,
  topPicksProviderIds,
} from './sources.js'
import { getHomeSectionsServerStatus } from './status.js'
import { placeViewerRows, type ManagedTagInfo } from './viewerRows.js'

const logger = createChildLogger('home-sections-sync')

/** Enough to diagnose a bad run without letting one broken item flood the result. */
const MAX_RECORDED_ERRORS = 25

export interface HomeSectionsSyncResult {
  jobId: string
  skipped?: 'not-configured' | 'unsupported-provider' | 'unsupported-server' | 'unreachable' | 'nothing-to-do'
  cancelled?: boolean
  serverVersion?: string | null
  viewersProcessed: number
  /** Accounts in the users table the media server no longer has. */
  viewersMissing: number
  sectionsCreated: number
  sectionsUpdated: number
  sectionsRemoved: number
  sectionsMoved: number
  tagsApplied: number
  tagsRemoved: number
  errorCount: number
  errors: Array<{ scope: string; message: string }>
}

/** What a tag should hold this run. `ids: null` means "could not tell — leave it". */
interface TagPlan {
  name: string
  ids: string[] | null
}

function recordError(jobId: string, result: HomeSectionsSyncResult, scope: string, err: unknown): void {
  result.errorCount++
  const message = err instanceof Error ? err.message : String(err)
  if (result.errors.length < MAX_RECORDED_ERRORS) {
    result.errors.push({ scope, message })
    // The summary line only counts failures. Without this the job console says
    // "4 step(s) failed" and the only record of which four is the container log.
    addLog(jobId, 'warn', `⚠️ ${scope}: ${message}`)
  }
  logger.warn({ scope, err }, 'Home sections sync step failed')
}

function summarize(result: HomeSectionsSyncResult): Record<string, unknown> {
  return {
    skipped: result.skipped,
    cancelled: result.cancelled,
    serverVersion: result.serverVersion,
    viewersProcessed: result.viewersProcessed,
    viewersMissing: result.viewersMissing,
    sectionsCreated: result.sectionsCreated,
    sectionsUpdated: result.sectionsUpdated,
    sectionsRemoved: result.sectionsRemoved,
    sectionsMoved: result.sectionsMoved,
    tagsApplied: result.tagsApplied,
    tagsRemoved: result.tagsRemoved,
    errorCount: result.errorCount,
    errors: result.errors,
  }
}

function emptyResult(jobId: string): HomeSectionsSyncResult {
  return {
    jobId,
    viewersProcessed: 0,
    viewersMissing: 0,
    sectionsCreated: 0,
    sectionsUpdated: 0,
    sectionsRemoved: 0,
    sectionsMoved: 0,
    tagsApplied: 0,
    tagsRemoved: 0,
    errorCount: 0,
    errors: [],
  }
}

export async function syncHomeSections(existingJobId?: string): Promise<HomeSectionsSyncResult> {
  const jobId = existingJobId || randomUUID()
  createJobProgress(jobId, 'sync-home-sections', 4)
  const result = emptyResult(jobId)

  const finish = (): HomeSectionsSyncResult => {
    completeJob(jobId, summarize(result))
    return result
  }
  const stopIfCancelled = (): boolean => {
    if (!isJobCancelled(jobId)) return false
    // cancelJob already filed the job_runs row; completing would be a second one.
    result.cancelled = true
    addLog(jobId, 'warn', '🛑 Cancelled — rows and tags already written are left in place')
    return true
  }

  try {
    // ------------------------------------------------------------------ gate
    setJobStep(jobId, 0, 'Checking the media server')
    const config = await getHomeSectionsConfig()
    const status = await getHomeSectionsServerStatus()
    result.serverVersion = status.serverVersion

    if (!status.supported) {
      result.skipped = status.reason === 'ok' ? 'unreachable' : status.reason
      const why: Record<string, string> = {
        'not-configured': 'no media server is configured',
        'unsupported-provider': `managed home sections are Emby-only (this server is ${status.providerType})`,
        'unsupported-server': `Emby ${status.minVersion} or newer is required (found ${status.serverVersion ?? 'unknown'})`,
        unreachable: 'the media server did not answer',
      }
      addLog(jobId, 'warn', `⏭️ Skipped: ${why[result.skipped] ?? result.skipped}`)
      return finish()
    }

    const provider: MediaServerProvider = await getMediaServerProvider()
    const apiKey = await getMediaServerApiKey()
    if (!apiKey) {
      result.skipped = 'not-configured'
      addLog(jobId, 'warn', '⏭️ Skipped: no media server API key')
      return finish()
    }

    const tagsBefore = await provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX)
    if (!config.enabled && tagsBefore.length === 0) {
      result.skipped = 'nothing-to-do'
      addLog(jobId, 'info', '⏭️ Home sections are switched off and nothing is left to remove')
      return finish()
    }
    addLog(
      jobId,
      'info',
      config.enabled
        ? `📺 Emby ${status.serverVersion}: syncing managed home rows`
        : `🧹 Home sections are switched off: removing ${tagsBefore.length} managed tag(s) and their rows`
    )

    // ------------------------------------------------------ what rows hold
    setJobStep(jobId, 1, 'Working out what each row should hold')
    const viewers = await loadViewers(provider.type)
    const targets = viewers.filter((viewer) =>
      isHomeSectionTarget({ isEnabled: viewer.is_enabled, providerDisabled: viewer.provider_disabled })
    )
    const targetIds = new Set(targets.map((viewer) => viewer.id))
    const topPicksViewerIds = new Set(
      viewers
        .filter((viewer) => isTopPicksTarget({ providerDisabled: viewer.provider_disabled }))
        .map((viewer) => viewer.id)
    )

    const tagPlans = new Map<string, TagPlan>()
    const planTag = (name: string, ids: string[] | null) => tagPlans.set(name.toLowerCase(), { name, ids })

    const topPicksOn =
      config.enabled &&
      config.topPicksEnabled &&
      topPicksViewerIds.size > 0 &&
      (await getTopPicksConfig()).isEnabled
    for (const kind of ['top-picks-movies', 'top-picks-series'] as const) {
      if (!topPicksOn) {
        planTag(TOP_PICKS_TAGS[kind], [])
        continue
      }
      try {
        const ids = await topPicksProviderIds(kind)
        planTag(TOP_PICKS_TAGS[kind], ids)
        addLog(jobId, 'info', `🔥 ${kind}: ${ids.length} titles`)
      } catch (err) {
        planTag(TOP_PICKS_TAGS[kind], null)
        recordError(jobId, result, kind, err)
        addLog(jobId, 'warn', `⚠️ ${kind}: could not load the list, leaving the row as it is`)
      }
    }

    const viewerTags = await loadViewerTags()
    const recsOn = config.enabled && config.recommendationsEnabled

    for (const viewer of targets) {
      if (!recsOn) break
      try {
        const movies = await recommendedProviderIds(viewer, 'movie', config.recommendationsLimit)
        const series = await recommendedProviderIds(viewer, 'series', config.recommendationsLimit)
        let tag = viewerTags.get(viewer.id)
        if (!tag && (movies.length > 0 || series.length > 0)) {
          tag = await mintViewerTag(viewer.id)
          viewerTags.set(viewer.id, tag)
        }
        if (tag) {
          const names = recsTagNames(tag)
          planTag(names.movies, movies)
          planTag(names.series, series)
        }
      } catch (err) {
        const tag = viewerTags.get(viewer.id)
        if (tag) {
          const names = recsTagNames(tag)
          planTag(names.movies, null)
          planTag(names.series, null)
        }
        recordError(jobId, result, `recommendations:${viewer.username}`, err)
      }
    }

    // Generated playlists go only to their owner, and only while playlists are on.
    const homePlaylists = await loadHomePlaylists()
    const playlistsOn = config.enabled && config.playlistsEnabled
    for (const playlist of homePlaylists) {
      if (!playlistsOn || !targetIds.has(playlist.ownerId)) {
        planTag(playlist.tagName, [])
        continue
      }
      try {
        planTag(playlist.tagName, await playlistProviderIds(provider, apiKey, playlist))
      } catch (err) {
        planTag(playlist.tagName, null)
        recordError(jobId, result, `playlist:${playlist.name}`, err)
      }
    }

    // Everyone else's tags, and every managed tag nobody accounts for, empty.
    for (const [userId, tag] of viewerTags) {
      if (!recsOn || !targetIds.has(userId)) {
        const names = recsTagNames(tag)
        planTag(names.movies, [])
        planTag(names.series, [])
      }
    }
    for (const tag of tagsBefore) {
      if (!tagPlans.has(tag.name.toLowerCase())) planTag(tag.name, [])
    }

    // -------------------------------------------------------- tag the items
    setJobStep(jobId, 2, 'Tagging library items', tagPlans.size)
    const idBefore = new Map(tagsBefore.map((tag) => [tag.name.toLowerCase(), tag.id]))
    let tagIndex = 0
    for (const [key, plan] of tagPlans) {
      if (stopIfCancelled()) return result
      updateJobProgress(jobId, tagIndex++, tagPlans.size, plan.name)
      if (plan.ids === null) continue
      const existed = idBefore.has(key)
      if (!existed && plan.ids.length === 0) continue

      try {
        const current = existed ? await provider.getItemIdsWithTag(apiKey, plan.name) : []
        const { add, remove } = diffMembership(current, plan.ids)
        const tag = { name: plan.name, id: idBefore.get(key) }
        for (const itemId of add) {
          try {
            await provider.addItemTag(apiKey, itemId, tag)
            result.tagsApplied++
          } catch (err) {
            recordError(jobId, result, `tag ${plan.name} +${itemId}`, err)
          }
        }
        for (const itemId of remove) {
          try {
            await provider.removeItemTag(apiKey, itemId, tag)
            result.tagsRemoved++
          } catch (err) {
            recordError(jobId, result, `tag ${plan.name} -${itemId}`, err)
          }
        }
      } catch (err) {
        // Membership unknown: treat like a failed source and leave its rows be.
        plan.ids = null
        recordError(jobId, result, `tag ${plan.name}`, err)
      }
    }
    addLog(jobId, 'info', `🏷️ Tags: ${result.tagsApplied} applied, ${result.tagsRemoved} removed`)

    const tagsAfter = await provider.getTagsByPrefix(apiKey, MANAGED_TAG_PREFIX)
    const tagIdByName = new Map(tagsAfter.map((tag) => [tag.name.toLowerCase(), tag.id as string]))
    const managedTagIds = new Set(
      [...tagsBefore, ...tagsAfter].map((tag) => tag.id).filter((id): id is string => !!id)
    )

    // ------------------------------------------------------ home screens
    setJobStep(jobId, 3, 'Updating home screens', viewers.length)
    // Read after the tags, so a placement saved while this run was tagging still applies.
    const [overrides, appliedKeys, placements] = await Promise.all([
      getUserPlacements(),
      getAppliedPlacementKeys(),
      getHomeSectionsConfig().then((fresh) => fresh.placements),
    ])

    for (const [index, viewer] of viewers.entries()) {
      if (stopIfCancelled()) return result
      updateJobProgress(jobId, index, viewers.length, viewer.username)

      const desired: DesiredRow[] = []
      const preserveTagIds = new Set<string>()
      const managed = new Map<string, ManagedTagInfo>()
      const isTarget = targetIds.has(viewer.id)

      const considerRow = (kind: ManagedRowKind, tagName: string | undefined, name: string, itemTypes: string[]) => {
        if (!tagName) return
        const plan = tagPlans.get(tagName.toLowerCase())
        const tagId = tagIdByName.get(tagName.toLowerCase()) ?? idBefore.get(tagName.toLowerCase())
        if (!plan || !tagId) return
        if (plan.ids === null) {
          preserveTagIds.add(tagId)
          managed.set(tagId, { feature: featureOfKind(kind), name })
        } else if (plan.ids.length > 0 && tagIdByName.has(tagName.toLowerCase())) {
          desired.push({ kind, tagId, name, itemTypes, sortBy: config.sortBy })
          managed.set(tagId, { feature: featureOfKind(kind), name })
        }
      }

      if (topPicksViewerIds.has(viewer.id)) {
        considerRow('top-picks-movies', TOP_PICKS_TAGS['top-picks-movies'], config.topPicksMoviesName, ['Movie'])
        considerRow('top-picks-series', TOP_PICKS_TAGS['top-picks-series'], config.topPicksSeriesName, ['Series'])
      }
      if (isTarget) {
        const viewerTag = viewerTags.get(viewer.id)
        if (viewerTag) {
          const names = recsTagNames(viewerTag)
          considerRow('recs-movies', names.movies, config.recommendationsMoviesName, ['Movie'])
          considerRow('recs-series', names.series, config.recommendationsSeriesName, ['Series'])
        }
        for (const playlist of homePlaylists) {
          if (playlist.ownerId === viewer.id) {
            considerRow('playlist', playlist.tagName, playlist.name, ['Movie', 'Series'])
          }
        }
      }

      try {
        let sections: ContentSection[]
        try {
          sections = await provider.getHomeSections(apiKey, viewer.provider_user_id)
        } catch (err) {
          // Nothing marks an account deleted from Emby: the user sync only imports and
          // updates, so its row stays behind, not provider_disabled, and Top Picks is
          // written to it every night. That is ordinary for any server that has ever
          // removed a user, so it is not a failure — but only once the account itself
          // is confirmed gone, or a sections endpoint answering 404 would skip every
          // viewer and report success.
          if (!isEmbyNotFoundError(err) || !(await accountIsGone(provider, apiKey, viewer.provider_user_id))) {
            throw err
          }
          result.viewersMissing++
          logger.debug({ user: viewer.username }, 'Viewer no longer exists on the media server')
          continue
        }
        const plan = planViewerSections({ existing: sections, managedTagIds, desired, preserveTagIds })

        if (plan.deletes.length > 0) {
          await provider.deleteHomeSections(apiKey, viewer.provider_user_id, plan.deletes)
          result.sectionsRemoved += plan.deletes.length
        }
        for (const section of plan.updates) {
          await provider.saveHomeSection(apiKey, viewer.provider_user_id, section)
          result.sectionsUpdated++
        }
        const created = new Set<PlacementFeature>()
        for (const section of plan.creates) {
          await provider.saveHomeSection(apiKey, viewer.provider_user_id, section)
          result.sectionsCreated++
          const info = managed.get(sectionTagIds(section)[0] ?? '')
          if (info) created.add(info.feature)
        }

        if (managed.size > 0) {
          // A created section's id is only learnable by reading the list back.
          const current =
            plan.creates.length > 0 || plan.deletes.length > 0
              ? await provider.getHomeSections(apiKey, viewer.provider_user_id)
              : sections
          const placed = await placeViewerRows({
            provider,
            apiKey,
            userId: viewer.id,
            providerUserId: viewer.provider_user_id,
            sections: current,
            managed,
            defaults: placements,
            overrides: overrides.get(viewer.id),
            applied: appliedKeys.get(viewer.id),
            force: created,
          })
          result.sectionsMoved += placed.moved
        }
        result.viewersProcessed++
      } catch (err) {
        recordError(jobId, result, `home screen:${viewer.username}`, err)
      }
    }
    updateJobProgress(jobId, viewers.length, viewers.length)

    addLog(
      jobId,
      result.errorCount > 0 ? 'warn' : 'info',
      `✅ ${result.viewersProcessed} home screens: ${result.sectionsCreated} rows created, ` +
        `${result.sectionsUpdated} updated, ${result.sectionsRemoved} removed, ${result.sectionsMoved} moved` +
        (result.viewersMissing > 0
          ? `; ${result.viewersMissing} account(s) no longer on the media server skipped`
          : '') +
        (result.errorCount > 0 ? ` — ${result.errorCount} step(s) failed (listed above)` : '') +
        (result.errorCount > result.errors.length
          ? `; only the first ${result.errors.length} are listed, the rest are in the container log`
          : '')
    )
    return finish()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, message)
    logger.error({ err }, 'Home sections sync failed')
    throw err
  }
}
