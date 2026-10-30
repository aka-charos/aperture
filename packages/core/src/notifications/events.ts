/**
 * What happened to one person in a window of time, read from where each event
 * already lives, and written in their language. Both channels go through
 * `collectNotifications`, so an email and a phone can never disagree about
 * what counts as news.
 *
 * Nothing here writes. In particular the Seerr identity is READ from
 * `users.seerr_user_id` and never resolved: resolving writes the link, and a
 * read that writes would defeat the read-only guard of an assumed session.
 * Someone whose Seerr account was never linked simply gets no issue events
 * until they file or open an issue, which links it.
 */
import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getLibraryScopeForUser } from '../lib/libraryScope.js'
import { listInbox } from '../social/recommendations.js'
import { getIssue, isSeerrConfigured, listIssues } from '../seerr/provider.js'
import { seerrDisplayName } from '../seerr/displayName.js'
import type { SeerrIssue } from '../seerr/types.js'
import {
  MAX_EVENTS_PER_CHECK,
  requestChangeNotifies,
  type NotificationEvent,
} from './rules.js'
import { notificationText, type NotificationStringKey } from './strings.js'

const logger = createChildLogger('notifications')

export interface NotificationItem {
  /** Stable for one occurrence, so a client can tell a repeat from a new event. */
  id: string
  event: NotificationEvent
  /** When it happened, ISO. */
  at: string
  title: string
  body: string
  /** Where it opens in the app, a path on this instance. */
  path: string
}

export interface CheckWindow {
  since: Date
  until: Date
}

/**
 * Issues read per check, most recently changed first. Large enough that a
 * person who can manage issues, and so is shown everyone's, still finds their
 * own among them; one request either way.
 */
const ISSUES_EXAMINED = 100
/** How much of a reply a notification quotes. */
const REPLY_CHARS = 140

function inWindow(at: Date, window: CheckWindow): boolean {
  const time = at.getTime()
  return time > window.since.getTime() && time <= window.until.getTime()
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/**
 * Every event the person has switched on for this channel, inside the window,
 * oldest first and at most `MAX_EVENTS_PER_CHECK` (the newest kept). A source
 * that fails is logged and skipped, never fatal: one unreachable Seerr must not
 * cost someone their Watch This notification.
 */
export async function collectNotifications(
  userId: string,
  events: readonly NotificationEvent[],
  window: CheckWindow,
  locale: string
): Promise<NotificationItem[]> {
  const t = (key: NotificationStringKey, vars?: Record<string, string>) => notificationText(locale, key, vars)
  const sources: Record<NotificationEvent, () => Promise<NotificationItem[]>> = {
    watchThis: () => watchThisEvents(userId, window, t),
    requests: () => requestEvents(userId, window, t),
    issueReplies: () => issueEvents(userId, window, t),
    recommendations: () => recommendationEvents(userId, window, t),
  }

  const found = await Promise.all(
    events.map(async (event) => {
      try {
        return await sources[event]()
      } catch (err) {
        logger.warn({ err, userId, event }, 'Could not read notification events')
        return []
      }
    })
  )

  return found
    .flat()
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .slice(-MAX_EVENTS_PER_CHECK)
}

type Text = (key: NotificationStringKey, vars?: Record<string, string>) => string

/** The Watch This inbox, which already applies visibility, the reader's scope, dismissal and "finished". */
async function watchThisEvents(userId: string, window: CheckWindow, t: Text): Promise<NotificationItem[]> {
  const groups = await listInbox(userId, await getLibraryScopeForUser(userId))
  return groups.flatMap((group) =>
    group.items
      .filter((item) => inWindow(new Date(item.recommendedAt), window))
      .map((item) => ({
        id: `watchThis:${item.id}:${item.recommendedAt}`,
        event: 'watchThis' as const,
        at: item.recommendedAt,
        title: t('watchThis.title', { sender: group.recommender.name || t('someone') }),
        body: t('watchThis.body', { title: item.year ? `${item.title} (${item.year})` : item.title }),
        path: '/watch-this',
      }))
  )
}

async function requestEvents(userId: string, window: CheckWindow, t: Text): Promise<NotificationItem[]> {
  const rows = await query<{ id: string; title: string; status: string; created_at: Date; status_changed_at: Date }>(
    `SELECT id, title, status, created_at, status_changed_at
       FROM discovery_requests
      WHERE user_id = $1
        AND status_changed_at > $2 AND status_changed_at <= $3
        AND status IN ('approved', 'declined', 'available')`,
    [userId, window.since, window.until]
  )
  return rows.rows.flatMap((row) => {
    const status = row.status
    if (!requestChangeNotifies(status, row.created_at, row.status_changed_at)) return []
    const at = row.status_changed_at.toISOString()
    return [
      {
        id: `requests:${row.id}:${status}:${at}`,
        event: 'requests' as const,
        at,
        title: t(`requests.${status}.title`),
        body: t(`requests.${status}.body`, { title: row.title }),
        path: '/my-requests',
      },
    ]
  })
}

async function libraryTitle(mediaType: 'movie' | 'tv', tmdbId: number): Promise<string | null> {
  const table = mediaType === 'tv' ? 'series' : 'movies'
  const row = await queryOne<{ title: string }>(
    `SELECT title FROM ${table} WHERE tmdb_id = $1 ORDER BY created_at, id LIMIT 1`,
    [String(tmdbId)]
  )
  return row?.title ?? null
}

/**
 * When each resolved issue was first seen resolved, recorded now for any not
 * seen before; reopened issues lose their record. One read and at most two
 * writes per person per check, however many issues they have.
 */
async function resolutionTimes(resolved: SeerrIssue[], reopenedIds: number[]): Promise<Map<number, Date>> {
  if (reopenedIds.length > 0) {
    await query(`DELETE FROM notification_issue_resolutions WHERE issue_id = ANY($1::int[])`, [reopenedIds])
  }
  if (resolved.length === 0) return new Map()
  await query(
    `INSERT INTO notification_issue_resolutions (issue_id, resolved_at)
     SELECT * FROM unnest($1::int[], $2::timestamptz[])
     ON CONFLICT (issue_id) DO NOTHING`,
    [resolved.map((issue) => issue.id), resolved.map((issue) => issue.updatedAt)]
  )
  const rows = await query<{ issue_id: number; resolved_at: Date }>(
    `SELECT issue_id, resolved_at FROM notification_issue_resolutions WHERE issue_id = ANY($1::int[])`,
    [resolved.map((issue) => issue.id)]
  )
  return new Map(rows.rows.map((row) => [row.issue_id, row.resolved_at]))
}

/** Replies by someone else and resolutions by someone else, on issues the person reported in Seerr. */
async function issueEvents(userId: string, window: CheckWindow, t: Text): Promise<NotificationItem[]> {
  const user = await queryOne<{ seerr_user_id: number | null }>(`SELECT seerr_user_id FROM users WHERE id = $1`, [userId])
  const seerrUserId = user?.seerr_user_id ?? null
  if (seerrUserId == null || !(await isSeerrConfigured())) return []

  // Seerr scopes the list to the caller's own issues only for someone who
  // cannot manage issues; a person who can is shown everyone's. Either way,
  // only issues they reported are theirs to hear about.
  const listed = await listIssues({ actAsUserId: seerrUserId, sort: 'modified', take: ISSUES_EXAMINED })
  if (!listed) return []
  const own = listed.results.filter((issue) => issue.createdBy?.id === seerrUserId)

  // The list carries each thread's comments (the Issues panel reads them from
  // it), so a thread is opened only if a Seerr version ever leaves them out.
  const issues = await Promise.all(
    own.map((issue) => (issue.comments ? issue : getIssue(issue.id, { actAsUserId: seerrUserId })))
  )
  const present = issues.filter((issue): issue is SeerrIssue => issue != null)
  const resolvedAt = await resolutionTimes(
    present.filter((issue) => issue.status === 2),
    present.filter((issue) => issue.status !== 2).map((issue) => issue.id)
  )

  const items: NotificationItem[] = []
  for (const issue of present) {
    const replies = (issue.comments ?? [])
      // The first comment is the report itself, never a reply.
      .slice(1)
      .filter((comment) => comment.user?.id !== seerrUserId && inWindow(new Date(comment.createdAt), window))
    const resolved = resolvedAt.get(issue.id)
    const announceResolution = resolved != null && issue.modifiedBy?.id !== seerrUserId && inWindow(resolved, window)
    if (replies.length === 0 && !announceResolution) continue

    const mediaType = issue.media?.mediaType === 'tv' ? 'tv' : 'movie'
    const title =
      (issue.media?.tmdbId ? await libraryTitle(mediaType, issue.media.tmdbId) : null) ??
      (issue.media?.tmdbId ? `TMDb #${issue.media.tmdbId}` : '')

    for (const comment of replies) {
      items.push({
        id: `issueReplies:${issue.id}:comment:${comment.id}`,
        event: 'issueReplies',
        at: new Date(comment.createdAt).toISOString(),
        title: t('issueReplies.reply.title'),
        body: t('issueReplies.reply.body', {
          author: seerrDisplayName(comment.user) ?? t('someone'),
          title,
          message: clip(comment.message ?? '', REPLY_CHARS),
        }),
        path: '/my-requests?tab=issues',
      })
    }

    if (announceResolution) {
      const at = resolved.toISOString()
      items.push({
        id: `issueReplies:${issue.id}:resolved:${at}`,
        event: 'issueReplies',
        at,
        title: t('issueReplies.resolved.title'),
        body: t('issueReplies.resolved.body', { title }),
        path: '/my-requests?tab=issues',
      })
    }
  }
  return items
}

/** A completed run per media type. Channel runs are a channel's, not the person's list. */
async function recommendationEvents(userId: string, window: CheckWindow, t: Text): Promise<NotificationItem[]> {
  const rows = await query<{ id: string; media_type: string; completed_at: Date }>(
    `SELECT DISTINCT ON (media_type) id, media_type, completed_at
       FROM recommendation_runs
      WHERE user_id = $1 AND status = 'completed' AND channel_id IS NULL
        AND completed_at > $2 AND completed_at <= $3
      ORDER BY media_type, completed_at DESC`,
    [userId, window.since, window.until]
  )
  return rows.rows.map((row) => {
    const kind = row.media_type === 'series' ? 'series' : 'movie'
    return {
      id: `recommendations:${row.id}`,
      event: 'recommendations' as const,
      at: row.completed_at.toISOString(),
      title: t(`recommendations.${kind}.title`),
      body: t(`recommendations.${kind}.body`),
      path: '/recommendations',
    }
  })
}
