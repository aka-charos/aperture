/**
 * Sync managed rows onto every viewer's Emby home screen (job `sync-home-sections`).
 *
 * One run is three passes, in this order because each needs the one before:
 *
 * 1. Work out what every managed tag should hold: the Top Picks lists, each
 *    viewer's newest completed picks (a movies tag and a series tag), the
 *    titles their connections recommended to them, and every generated
 *    playlist an owner put on their home screen. Which rows reach which viewer
 *    is `resolveRowStates` — the server, the operator and the viewer's own
 *    switches, in that order (rowStates.ts). A tag this run cannot account for
 *    — a deleted viewer's, a switched-off row's, 0173's mixed recommendations
 *    tag — should hold nothing.
 * 2. Tag and untag the ORIGINAL library items to match. A section filters by tag
 *    id and a tag has an id only once an item carries it, so ids are read after.
 * 3. Read each viewer's sections back and reconcile them (apply.ts): create,
 *    update and remove, then place the rows whose placement changed or that were
 *    just created (placement.ts, viewerRows.ts). The instant path for one viewer
 *    (instant.ts) runs the same steps, so the two cannot write a row differently.
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
import { reconcileViewerScreen, viewerDesiredRows, writeTagMembership, type TagPlan } from './apply.js'
import { TOP_PICKS_TAGS, friendsTagName, recsTagNames } from './plan.js'
import type { PlacementFeature } from './placement.js'
import { getAppliedPlacementKeys, getUserPlacements, getUserRowSwitches } from './placementStore.js'
import { loadHomePlaylists } from './playlists.js'
import { resolveRowStates } from './rowStates.js'
import {
  accountIsGone,
  friendRecommendedProviderIds,
  loadViewerTags,
  loadViewers,
  mintViewerTag,
  playlistProviderIds,
  recommendedProviderIds,
  rowStateViewer,
  topPicksProviderIds,
} from './sources.js'
import { getHomeSectionsServerStatus } from './status.js'

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
    const [switches, topPicksListEnabled] = await Promise.all([
      getUserRowSwitches(),
      getTopPicksConfig().then((topPicks) => topPicks.isEnabled),
    ])
    // Which rows reach which viewer. resolveRowStates is the one answer, shared with the
    // instant path and the viewer's settings page, so none of them can disagree with this run.
    const statesByViewer = new Map(
      viewers.map((viewer) => [
        viewer.id,
        resolveRowStates({
          config,
          topPicksListEnabled,
          viewer: rowStateViewer(viewer),
          switches: switches.get(viewer.id),
        }),
      ])
    )
    const isOn = (viewerId: string, feature: PlacementFeature) =>
      statesByViewer.get(viewerId)?.[feature].status === 'on'

    const tagPlans = new Map<string, TagPlan>()
    const planTag = (name: string, ids: string[] | null) => tagPlans.set(name.toLowerCase(), { name, ids })

    // One list per kind for the whole server, filled while anybody still wants it.
    for (const kind of ['top-picks-movies', 'top-picks-series'] as const) {
      if (!viewers.some((viewer) => isOn(viewer.id, kind))) {
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

    // Each viewer's own rows. Every source is asked separately, so one failing
    // (null: leave that row as it is) does not blank the others.
    const viewerTags = await loadViewerTags()
    for (const viewer of viewers) {
      const wanted = {
        movies: isOn(viewer.id, 'recs-movies'),
        series: isOn(viewer.id, 'recs-series'),
        friends: isOn(viewer.id, 'friends'),
      }
      if (!wanted.movies && !wanted.series && !wanted.friends) continue

      const load = async (want: boolean, scope: string, read: () => Promise<string[]>): Promise<string[] | null> => {
        if (!want) return []
        try {
          return await read()
        } catch (err) {
          recordError(jobId, result, `${scope}:${viewer.username}`, err)
          return null
        }
      }
      const movies = await load(wanted.movies, 'recommendations', () =>
        recommendedProviderIds(viewer, 'movie', config.recommendationsLimit)
      )
      const series = await load(wanted.series, 'recommendations', () =>
        recommendedProviderIds(viewer, 'series', config.recommendationsLimit)
      )
      const friends = await load(wanted.friends, 'friends', () => friendRecommendedProviderIds(viewer))

      let tag = viewerTags.get(viewer.id)
      if (!tag && [movies, series, friends].some((ids) => ids !== null && ids.length > 0)) {
        try {
          tag = await mintViewerTag(viewer.id)
          viewerTags.set(viewer.id, tag)
        } catch (err) {
          recordError(jobId, result, `tag:${viewer.username}`, err)
        }
      }
      if (tag) {
        const names = recsTagNames(tag)
        planTag(names.movies, movies)
        planTag(names.series, series)
        planTag(friendsTagName(tag), friends)
      }
    }

    // Generated playlists go only to their owner, and only while their playlist row is on.
    const homePlaylists = await loadHomePlaylists()
    for (const playlist of homePlaylists) {
      if (!isOn(playlist.ownerId, 'playlists')) {
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

    // A viewer's rows nobody asked for this run — switched off, by them or by
    // the operator, or a viewer who is gone — hold nothing, and neither does
    // any managed tag nobody accounts for.
    for (const tag of viewerTags.values()) {
      const names = recsTagNames(tag)
      for (const name of [names.movies, names.series, friendsTagName(tag)]) {
        if (!tagPlans.has(name.toLowerCase())) planTag(name, [])
      }
    }
    for (const tag of tagsBefore) {
      if (!tagPlans.has(tag.name.toLowerCase())) planTag(tag.name, [])
    }

    // -------------------------------------------------------- tag the items
    setJobStep(jobId, 2, 'Tagging library items', tagPlans.size)
    const idBefore = new Map(
      tagsBefore.flatMap((tag) => (tag.id ? [[tag.name.toLowerCase(), tag.id] as [string, string]] : []))
    )
    let tagIndex = 0
    for (const [key, plan] of tagPlans) {
      if (stopIfCancelled()) return result
      updateJobProgress(jobId, tagIndex++, tagPlans.size, plan.name)
      if (plan.ids === null) continue
      try {
        const written = await writeTagMembership({
          provider,
          apiKey,
          name: plan.name,
          ids: plan.ids,
          existingId: idBefore.get(key),
          onItemError: (scope, err) => recordError(jobId, result, scope, err),
        })
        result.tagsApplied += written.applied
        result.tagsRemoved += written.removed
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

      const states = statesByViewer.get(viewer.id)
      if (!states) continue
      const rows = viewerDesiredRows({
        viewerId: viewer.id,
        states,
        names: config,
        sortBy: config.sortBy,
        viewerTagName: viewerTags.get(viewer.id),
        playlists: homePlaylists,
        tagPlans,
        tagIdByName,
        idBefore,
      })

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

        const written = await reconcileViewerScreen({
          provider,
          apiKey,
          userId: viewer.id,
          providerUserId: viewer.provider_user_id,
          sections,
          managedTagIds,
          rows,
          defaults: placements,
          overrides: overrides.get(viewer.id),
          applied: appliedKeys.get(viewer.id),
        })
        result.sectionsCreated += written.created
        result.sectionsUpdated += written.updated
        result.sectionsRemoved += written.removed
        result.sectionsMoved += written.moved
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
