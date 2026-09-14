/**
 * Sync managed rows onto every viewer's Emby home screen (job `sync-home-sections`).
 *
 * One run is three passes, in this order because each needs the one before:
 *
 * 1. Work out what every managed tag should hold: the Top Picks lists, and each
 *    enabled viewer's newest completed picks, and every generated playlist an
 *    owner put on their home screen. A tag this run cannot account for —
 *    a deleted viewer's, a switched-off row's — should hold nothing.
 * 2. Tag and untag the ORIGINAL library items to match. A section filters by tag
 *    id and a tag has an id only once an item carries it, so ids are read after.
 * 3. Read each viewer's sections back and reconcile them (plan.ts): create,
 *    update, remove, and move.
 *
 * Switching the feature off is not a separate path: with it off every tag
 * should hold nothing and nobody should have a row, so the same run removes
 * everything an earlier run wrote.
 *
 * Failure is never read as emptiness. When a row's contents cannot be worked
 * out, its tag is not touched and its sections are preserved as they are.
 */

import { randomBytes, randomUUID } from 'crypto'
import { query } from '../lib/db.js'
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
import { getMediaServerApiKey } from '../settings/systemSettings.js'
import { getTopPicksConfig } from '../topPicks/config.js'
import { getTopMovies, getTopSeries } from '../topPicks/popularity.js'
import { getHomeSectionsConfig, markSectionPositionApplied } from './config.js'
import {
  TOP_PICKS_TAGS,
  diffMembership,
  isHomeSectionTarget,
  orderRows,
  planMoves,
  planViewerSections,
  recsTagName,
  type DesiredRow,
  type ManagedRowKind,
} from './plan.js'
import { loadHomePlaylists, type HomePlaylist } from './playlists.js'
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
  sectionsCreated: number
  sectionsUpdated: number
  sectionsRemoved: number
  sectionsMoved: number
  tagsApplied: number
  tagsRemoved: number
  errorCount: number
  errors: Array<{ scope: string; message: string }>
}

interface ViewerRow {
  id: string
  username: string
  provider_user_id: string
  is_enabled: boolean
  movies_enabled: boolean
  series_enabled: boolean
  provider_disabled: boolean
}

/** What a tag should hold this run. `ids: null` means "could not tell — leave it". */
interface TagPlan {
  name: string
  ids: string[] | null
}

function recordError(result: HomeSectionsSyncResult, scope: string, err: unknown): void {
  result.errorCount++
  const message = err instanceof Error ? err.message : String(err)
  if (result.errors.length < MAX_RECORDED_ERRORS) result.errors.push({ scope, message })
  logger.warn({ scope, err }, 'Home sections sync step failed')
}

function summarize(result: HomeSectionsSyncResult): Record<string, unknown> {
  return {
    skipped: result.skipped,
    cancelled: result.cancelled,
    serverVersion: result.serverVersion,
    viewersProcessed: result.viewersProcessed,
    sectionsCreated: result.sectionsCreated,
    sectionsUpdated: result.sectionsUpdated,
    sectionsRemoved: result.sectionsRemoved,
    sectionsMoved: result.sectionsMoved,
    tagsApplied: result.tagsApplied,
    tagsRemoved: result.tagsRemoved,
    errorCount: result.errorCount,
  }
}

/** Library ids for the Top Picks list, in rank order. */
async function topPicksProviderIds(kind: 'top-picks-movies' | 'top-picks-series'): Promise<string[]> {
  const ids =
    kind === 'top-picks-movies'
      ? (await getTopMovies()).map((pick) => pick.movieId)
      : (await getTopSeries()).map((pick) => pick.seriesId)
  if (ids.length === 0) return []

  const table = kind === 'top-picks-movies' ? 'movies' : 'series'
  const rows = await query<{ id: string; provider_item_id: string }>(
    `SELECT id, provider_item_id FROM ${table} WHERE id = ANY($1)`,
    [ids]
  )
  const byId = new Map(rows.rows.map((row) => [row.id, row.provider_item_id]))
  return ids.map((id) => byId.get(id)).filter((id): id is string => !!id)
}

/**
 * A viewer's selected picks from their newest COMPLETED run, best rank first.
 * `selected_rank`, never `final_score` — rank is what the page shows, and score
 * would bury reserved-slot picks (F-020). A superseded run still holds its
 * selected rows by design, which is why the run is pinned rather than selecting
 * every `is_selected` row the viewer ever had.
 */
async function recommendedProviderIds(viewer: ViewerRow, limit: number): Promise<string[]> {
  const ids: string[] = []

  if (viewer.movies_enabled) {
    const movies = await query<{ provider_item_id: string }>(
      `SELECT m.provider_item_id
       FROM recommendation_candidates rc
       JOIN movies m ON m.id = rc.movie_id
       WHERE rc.run_id = (
               SELECT id FROM recommendation_runs
               WHERE user_id = $1 AND status = 'completed' AND media_type = 'movie'
               ORDER BY created_at DESC
               LIMIT 1
             )
         AND rc.is_selected = true
         AND rc.movie_id IS NOT NULL
       ORDER BY rc.selected_rank ASC NULLS LAST
       LIMIT $2`,
      [viewer.id, limit]
    )
    ids.push(...movies.rows.map((row) => row.provider_item_id))
  }

  if (viewer.series_enabled) {
    const series = await query<{ provider_item_id: string }>(
      `SELECT s.provider_item_id
       FROM recommendation_candidates rc
       JOIN series s ON s.id = rc.series_id
       WHERE rc.run_id = (
               SELECT id FROM recommendation_runs
               WHERE user_id = $1 AND status = 'completed' AND media_type = 'series'
               ORDER BY created_at DESC
               LIMIT 1
             )
         AND rc.is_selected = true
         AND rc.series_id IS NOT NULL
       ORDER BY rc.selected_rank ASC NULLS LAST
       LIMIT $2`,
      [viewer.id, limit]
    )
    ids.push(...series.rows.map((row) => row.provider_item_id))
  }

  return ids
}

/**
 * A playlist's CURRENT items, read back from the media server — never rebuilt.
 * A channel's list is whatever its owner last generated and approved; rebuilding
 * it here would spend model calls every night and push titles the owner never saw.
 */
async function playlistProviderIds(
  provider: MediaServerProvider,
  apiKey: string,
  playlist: HomePlaylist
): Promise<string[]> {
  if (!playlist.containerId) return []
  try {
    return playlist.outputType === 'collection'
      ? await provider.getCollectionItems(apiKey, playlist.containerId)
      : (await provider.getPlaylistItems(apiKey, playlist.containerId)).map((item) => item.id)
  } catch (err) {
    // Deleted on the server: nothing left to show, so the row goes.
    if (isEmbyNotFoundError(err)) return []
    throw err
  }
}

async function loadViewerTags(): Promise<Map<string, string>> {
  const rows = await query<{ user_id: string; tag_name: string }>(
    `SELECT user_id, tag_name FROM home_sections_viewer_tags`
  )
  return new Map(rows.rows.map((row) => [row.user_id, row.tag_name]))
}

/** Mint a viewer's random tag, or return the one a concurrent writer stored. */
async function mintViewerTag(userId: string): Promise<string> {
  const candidate = recsTagName(randomBytes(5).toString('hex'))
  const row = await query<{ tag_name: string }>(
    `INSERT INTO home_sections_viewer_tags (user_id, tag_name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING tag_name`,
    [userId, candidate]
  )
  return row.rows[0].tag_name
}

function emptyResult(jobId: string): HomeSectionsSyncResult {
  return {
    jobId,
    viewersProcessed: 0,
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
    const viewers = (
      await query<ViewerRow>(
        `SELECT id, username, provider_user_id, is_enabled, movies_enabled, series_enabled, provider_disabled
         FROM users
         WHERE provider = $1 AND provider_user_id IS NOT NULL
         ORDER BY username`,
        [provider.type]
      )
    ).rows
    const targets = viewers.filter((viewer) =>
      isHomeSectionTarget({ isEnabled: viewer.is_enabled, providerDisabled: viewer.provider_disabled })
    )

    const tagPlans = new Map<string, TagPlan>()
    const planTag = (name: string, ids: string[] | null) => tagPlans.set(name.toLowerCase(), { name, ids })

    const topPicksOn =
      config.enabled && config.topPicksEnabled && targets.length > 0 && (await getTopPicksConfig()).isEnabled
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
        recordError(result, kind, err)
        addLog(jobId, 'warn', `⚠️ ${kind}: could not load the list, leaving the row as it is`)
      }
    }

    const viewerTags = await loadViewerTags()
    const recsOn = config.enabled && config.recommendationsEnabled
    const targetIds = new Set(targets.map((viewer) => viewer.id))

    for (const viewer of targets) {
      if (!recsOn) break
      try {
        const ids = await recommendedProviderIds(viewer, config.recommendationsLimit)
        let tag = viewerTags.get(viewer.id)
        if (!tag && ids.length > 0) {
          tag = await mintViewerTag(viewer.id)
          viewerTags.set(viewer.id, tag)
        }
        if (tag) planTag(tag, ids)
      } catch (err) {
        const tag = viewerTags.get(viewer.id)
        if (tag) planTag(tag, null)
        recordError(result, `recommendations:${viewer.username}`, err)
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
        recordError(result, `playlist:${playlist.name}`, err)
      }
    }

    // Everyone else's tag, and every managed tag nobody accounts for, empties.
    for (const [userId, tag] of viewerTags) {
      if (!recsOn || !targetIds.has(userId)) planTag(tag, [])
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
            recordError(result, `tag ${plan.name} +${itemId}`, err)
          }
        }
        for (const itemId of remove) {
          try {
            await provider.removeItemTag(apiKey, itemId, tag)
            result.tagsRemoved++
          } catch (err) {
            recordError(result, `tag ${plan.name} -${itemId}`, err)
          }
        }
      } catch (err) {
        // Membership unknown: treat like a failed source and leave its rows be.
        plan.ids = null
        recordError(result, `tag ${plan.name}`, err)
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
    const positionChanged = config.enabled && config.appliedSectionPosition !== config.sectionPosition
    let completedAllViewers = true

    for (const [index, viewer] of viewers.entries()) {
      if (stopIfCancelled()) return result
      updateJobProgress(jobId, index, viewers.length, viewer.username)

      const desired: DesiredRow[] = []
      const preserveTagIds = new Set<string>()
      const isTarget = targetIds.has(viewer.id)

      const considerRow = (kind: ManagedRowKind, tagName: string | undefined, name: string, itemTypes: string[]) => {
        if (!tagName) return
        const plan = tagPlans.get(tagName.toLowerCase())
        const tagId = tagIdByName.get(tagName.toLowerCase()) ?? idBefore.get(tagName.toLowerCase())
        if (!plan || !tagId) return
        if (plan.ids === null) preserveTagIds.add(tagId)
        else if (plan.ids.length > 0 && tagIdByName.has(tagName.toLowerCase())) {
          desired.push({ kind, tagId, name, itemTypes, sortBy: config.sortBy })
        }
      }

      if (isTarget) {
        considerRow('recs', viewerTags.get(viewer.id), config.recommendationsName, ['Movie', 'Series'])
        considerRow('top-picks-movies', TOP_PICKS_TAGS['top-picks-movies'], config.topPicksMoviesName, ['Movie'])
        considerRow('top-picks-series', TOP_PICKS_TAGS['top-picks-series'], config.topPicksSeriesName, ['Series'])
        for (const playlist of homePlaylists) {
          if (playlist.ownerId === viewer.id) {
            considerRow('playlist', playlist.tagName, playlist.name, ['Movie', 'Series'])
          }
        }
      }

      try {
        const sections = await provider.getHomeSections(apiKey, viewer.provider_user_id)
        const plan = planViewerSections({ existing: sections, managedTagIds, desired, preserveTagIds })

        if (plan.deletes.length > 0) {
          await provider.deleteHomeSections(apiKey, viewer.provider_user_id, plan.deletes)
          result.sectionsRemoved += plan.deletes.length
        }
        for (const section of plan.updates) {
          await provider.saveHomeSection(apiKey, viewer.provider_user_id, section)
          result.sectionsUpdated++
        }
        for (const section of plan.creates) {
          await provider.saveHomeSection(apiKey, viewer.provider_user_id, section)
          result.sectionsCreated++
        }

        if (desired.length > 0 && (plan.creates.length > 0 || positionChanged)) {
          // A created section's id is only learnable by reading the list back.
          const current =
            plan.creates.length > 0 ? await provider.getHomeSections(apiKey, viewer.provider_user_id) : sections
          const settled = planViewerSections({ existing: current, managedTagIds, desired, preserveTagIds })
          const idsInOrder = orderRows(desired)
            .map((row) => settled.existingIds.get(row.tagId))
            .filter((id): id is string => !!id)
          for (const step of planMoves(idsInOrder, config.sectionPosition)) {
            await provider.moveHomeSections(apiKey, viewer.provider_user_id, [step.id], step.index)
          }
          result.sectionsMoved += idsInOrder.length
        }
        result.viewersProcessed++
      } catch (err) {
        // An account Emby no longer has cannot hold rows; nothing to clean up.
        if (!isTarget && isEmbyNotFoundError(err)) {
          logger.debug({ user: viewer.username }, 'Viewer no longer exists on the media server')
          continue
        }
        completedAllViewers = false
        recordError(result, `home screen:${viewer.username}`, err)
      }
    }
    updateJobProgress(jobId, viewers.length, viewers.length)

    if (positionChanged && completedAllViewers) {
      await markSectionPositionApplied(config.sectionPosition)
    }

    addLog(
      jobId,
      result.errorCount > 0 ? 'warn' : 'info',
      `✅ ${result.viewersProcessed} home screens: ${result.sectionsCreated} rows created, ` +
        `${result.sectionsUpdated} updated, ${result.sectionsRemoved} removed` +
        (result.errorCount > 0 ? ` — ${result.errorCount} step(s) failed` : '')
    )
    return finish()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    failJob(jobId, message)
    logger.error({ err }, 'Home sections sync failed')
    throw err
  }
}
