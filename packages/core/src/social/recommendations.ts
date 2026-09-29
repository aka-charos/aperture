/**
 * Titles one person recommends to another: the recipient's inbox of them (the
 * Received tab and its sidebar badge) and the sender's record of them (the
 * Sent tab).
 *
 * In-app only: nothing is written to the media server. Four rules.
 *
 * 1. **"Finished" is derived, never stored.** A title leaves the inbox when the
 *    recipient finishes it, by the poster badge's own rule
 *    (`movieFinishedSql`/`seriesFinishedSql`, beside `getWatchStatusForUser`),
 *    so the inbox and the tick on the poster cannot disagree.
 *
 * 2. **Every read is filtered, nothing is deleted.** An item shows only while
 *    it is live (not dismissed), its sender is still a visible connection, and
 *    the recipient can open it NOW (their library scope and parental rating).
 *    A permission change after sending hides it; restoring the permission
 *    brings it back. The badge is the length of that same list, never its own
 *    COUNT, or the two disagree the moment any filter moves.
 *
 * 3. **The dialog's flags are UX, the send re-checks.** `assessRecipients` is
 *    the one assessment: the recommend dialog renders it and the POST re-runs
 *    it, so a recipient the dialog greyed out can never be sent to by a client
 *    that ignores the greying, and the two cannot report different reasons.
 *
 * 4. **The sender never learns of a dismissal.** The Sent tab reports a
 *    dismissed title as still waiting, and the dialog still says "already
 *    recommended" to that person. Either one disagreeing would give it away.
 *    What the sender does see — watched, partway through, can no longer open
 *    it — is what a connection could already read from the recipient's watch
 *    history, or what the dialog already says about their libraries.
 */

import { query } from '../lib/db.js'
import {
  binderFor,
  getLibraryScopeForUser,
  libraryScopeSql,
  loadConfiguredLibraries,
  type ConfiguredLibrary,
  type LibraryScope,
} from '../lib/libraryScope.js'
import { getWatchStatusForUser, movieFinishedSql, seriesFinishedSql } from '../watching/watchedItems.js'
import { avatarUrlFor, listVisibleConnections, type ConnectedUser } from './connections.js'
import {
  displayNameSql,
  groupInbox,
  isUuid,
  recipientSkipReason,
  sentStatus,
  visibleConnectionsSql,
  type SentStatus,
  type SkipReason,
} from './rules.js'

export type SocialMediaType = 'movie' | 'series'

export interface SocialItemRef {
  mediaType: SocialMediaType
  itemId: string
}

export interface SocialRecommendationItem {
  /** The recommendation row's id — what dismiss takes. */
  id: string
  mediaType: SocialMediaType
  /** The movie or series id. */
  itemId: string
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  /** ISO timestamp of the latest (re)send. */
  recommendedAt: string
}

export interface RecommendationGroup {
  recommender: { id: string; name: string; avatarUrl: string }
  /** Newest first. */
  items: SocialRecommendationItem[]
}

export interface SentRecommendationItem extends SocialRecommendationItem {
  status: SentStatus
  /**
   * Their played episodes of a series they have started, specials excluded —
   * the numbers their own poster pill shows. Absent for a movie and for a
   * series they have not started.
   */
  progress?: { watched: number; total: number }
}

export interface SentGroup {
  recipient: { id: string; name: string; avatarUrl: string }
  /** Newest first. */
  items: SentRecommendationItem[]
}

export interface RecipientAssessment {
  user: ConnectedUser
  /** Finished it. Always false when `unavailable` — see rules.ts rule 3. */
  alreadyWatched: boolean
  /** Outside THEIR library scope or above their parental rating. */
  unavailable: boolean
  /**
   * A row sender → them for this item exists, dismissed or not: counting only
   * live rows would tell the sender about a dismissal (rule 4).
   */
  alreadyRecommended: boolean
}

export interface RecommendOutcome {
  /** Rows now live: new, revived after a dismissal, or re-bumped. */
  sent: number
  skipped: Array<{ userId: string; reason: SkipReason }>
}

const ITEM_TABLE: Record<SocialMediaType, { table: string; column: string }> = {
  movie: { table: 'movies', column: 'movie_id' },
  series: { table: 'series', column: 'series_id' },
}

function finishedSql(mediaType: SocialMediaType, user: string, itemId: string): string {
  return mediaType === 'movie' ? movieFinishedSql(user, itemId) : seriesFinishedSql(user, itemId)
}

/**
 * One assessment per visible connection of the sender, in name order. N is a
 * household, so one small query per connection is cheaper than one clever one.
 */
export async function assessRecipients(
  recommenderId: string,
  item: SocialItemRef
): Promise<RecipientAssessment[]> {
  if (!isUuid(recommenderId) || !isUuid(item.itemId)) return []
  const connections = await listVisibleConnections(recommenderId)
  if (connections.length === 0) return []

  const libraries = await loadConfiguredLibraries()
  const { table, column } = ITEM_TABLE[item.mediaType]

  return Promise.all(
    connections.map(async (user): Promise<RecipientAssessment> => {
      const scope = await getLibraryScopeForUser(user.id, libraries)
      const params: unknown[] = [item.itemId, user.id, recommenderId]
      const bind = binderFor(params)
      const rows = await query<{ in_scope: boolean; finished: boolean; already_recommended: boolean }>(
        `SELECT ${libraryScopeSql(scope, 't', bind)} AS in_scope,
                ${finishedSql(item.mediaType, '$2::uuid', 't.id')} AS finished,
                EXISTS (SELECT 1 FROM social_recommendations r
                         WHERE r.recommender_user_id = $3::uuid AND r.recipient_user_id = $2::uuid
                           AND r.${column} = t.id) AS already_recommended
           FROM ${table} t
          WHERE t.id = $1::uuid`,
        params
      )
      const row = rows.rows[0]
      // No row: the title left the library. Nobody can open it.
      const inScope = row?.in_scope === true
      return {
        user,
        alreadyWatched: inScope && row?.finished === true,
        unavailable: !inScope,
        alreadyRecommended: row?.already_recommended === true,
      }
    })
  )
}

/**
 * Send one title to several people. The caller has already checked the title
 * is in the SENDER's scope (a title they cannot open answers 404, like the
 * detail page). Each recipient is re-assessed here (rule 3); the rest are
 * written in one statement, so a re-send revives a dismissed row and moves a
 * pending one back to the top instead of duplicating it.
 */
export async function recommendItemToUsers(
  recommenderId: string,
  item: SocialItemRef,
  recipientIds: readonly string[]
): Promise<RecommendOutcome> {
  const requested = [...new Set(recipientIds.filter(isUuid).map((id) => id.toLowerCase()))]
  const assessments = await assessRecipients(recommenderId, item)
  const byId = new Map(assessments.map((a) => [a.user.id.toLowerCase(), a]))

  const send: string[] = []
  const skipped: RecommendOutcome['skipped'] = []
  for (const id of requested) {
    const assessment = byId.get(id)
    const reason = recipientSkipReason({
      // Absent covers the sender's own id, an unknown id, and a connection
      // removed or without access since the dialog opened.
      connected: assessment !== undefined,
      inScope: assessment !== undefined && !assessment.unavailable,
      finished: assessment?.alreadyWatched === true,
    })
    if (reason) skipped.push({ userId: id, reason })
    else send.push(assessment!.user.id)
  }

  if (send.length > 0) {
    // The conflict target repeats social_recommendations_one_per_item exactly;
    // that is what lets Postgres infer the expression index.
    await query(
      `INSERT INTO social_recommendations
         (recommender_user_id, recipient_user_id, media_type, movie_id, series_id)
       SELECT $1::uuid, r.id, $3::text, $4::uuid, $5::uuid FROM UNNEST($2::uuid[]) AS r(id)
       ON CONFLICT (recommender_user_id, recipient_user_id, media_type, COALESCE(movie_id, series_id))
       DO UPDATE SET recommended_at = NOW(), dismissed_at = NULL`,
      [
        recommenderId,
        send,
        item.mediaType,
        item.mediaType === 'movie' ? item.itemId : null,
        item.mediaType === 'series' ? item.itemId : null,
      ]
    )
  }

  return { sent: send.length, skipped }
}

interface InboxRow {
  id: string
  media_type: SocialMediaType
  movie_id: string | null
  series_id: string | null
  recommended_at: Date
  recommender_user_id: string
  recommender_name: string
  title: string
  year: number | null
  poster_url: string | null
  genres: string[] | null
}

async function readInbox(recipientId: string, scope: LibraryScope) {
  if (!isUuid(recipientId)) return []
  const params: unknown[] = [recipientId]
  const bind = binderFor(params)
  // Filters, in the order a reader would ask (rule 2): live, from someone still
  // visible, openable by the recipient now, and not finished.
  const rows = await query<InboxRow>(
    `SELECT r.id, r.media_type, r.movie_id, r.series_id, r.recommended_at,
            r.recommender_user_id, ${displayNameSql('u')} AS recommender_name,
            COALESCE(m.title, s.title) AS title, COALESCE(m.year, s.year) AS year,
            COALESCE(m.poster_url, s.poster_url) AS poster_url,
            COALESCE(m.genres, s.genres, '{}') AS genres
       FROM social_recommendations r
       JOIN users u ON u.id = r.recommender_user_id
       LEFT JOIN movies m ON r.media_type = 'movie'  AND m.id = r.movie_id
       LEFT JOIN series s ON r.media_type = 'series' AND s.id = r.series_id
      WHERE r.recipient_user_id = $1::uuid
        AND r.dismissed_at IS NULL
        AND r.recommender_user_id IN (${visibleConnectionsSql('$1::uuid')})
        AND CASE r.media_type
              WHEN 'movie' THEN m.id IS NOT NULL
                            AND ${libraryScopeSql(scope, 'm', bind)}
                            AND NOT ${movieFinishedSql('$1::uuid', 'r.movie_id')}
              ELSE              s.id IS NOT NULL
                            AND ${libraryScopeSql(scope, 's', bind)}
                            AND NOT ${seriesFinishedSql('$1::uuid', 'r.series_id')}
            END
      ORDER BY r.recommended_at DESC, r.id`,
    params
  )

  return rows.rows.map((row) => ({
    recommenderId: row.recommender_user_id,
    recommenderName: row.recommender_name,
    item: {
      id: row.id,
      mediaType: row.media_type,
      itemId: (row.media_type === 'movie' ? row.movie_id : row.series_id) as string,
      title: row.title,
      year: row.year ?? null,
      posterUrl: row.poster_url,
      genres: row.genres ?? [],
      recommendedAt: row.recommended_at.toISOString(),
    } satisfies SocialRecommendationItem,
  }))
}

/** The recipient's inbox, one group per recommender. `scope` is the recipient's own. */
export async function listInbox(recipientId: string, scope: LibraryScope): Promise<RecommendationGroup[]> {
  const rows = await readInbox(recipientId, scope)
  return groupInbox(rows).map((group) => ({
    recommender: {
      id: group.recommenderId,
      name: group.recommenderName,
      avatarUrl: avatarUrlFor(group.recommenderId),
    },
    items: group.items.map((row) => row.item),
  }))
}

/**
 * The badge. Deliberately the length of the list `listInbox` reads rather than
 * a separate COUNT(*): the page and the badge must agree the moment a title is
 * finished, dismissed, scoped out or its sender disconnected (rule 2).
 */
export async function countInbox(recipientId: string, scope: LibraryScope): Promise<number> {
  return (await readInbox(recipientId, scope)).length
}

/**
 * The recipient dismisses one item. Ownership is checked in the same statement
 * (no read-then-write race), a second dismiss is still a success, and a row
 * that is missing or somebody else's both answer false — the route turns that
 * into 404 either way, so it never confirms another person's row exists.
 */
export async function dismissRecommendation(recipientId: string, id: string): Promise<boolean> {
  if (!isUuid(recipientId) || !isUuid(id)) return false
  const rows = await query<{ id: string }>(
    `UPDATE social_recommendations
        SET dismissed_at = COALESCE(dismissed_at, NOW())
      WHERE id = $1 AND recipient_user_id = $2
      RETURNING id`,
    [id, recipientId]
  )
  return rows.rows.length > 0
}

interface SentRow {
  id: string
  recipient_user_id: string
  media_type: SocialMediaType
  movie_id: string | null
  series_id: string | null
  recommended_at: Date
  title: string
  year: number | null
  poster_url: string | null
  genres: string[] | null
}

/**
 * What the sender sent, to people still visible to them, that the SENDER can
 * open now (their scope, as on every social surface). Dismissed rows are kept
 * on purpose (rule 4). The unique index leads with `recommender_user_id`, so
 * this reads by index.
 */
async function readSent(recommenderId: string, scope: LibraryScope): Promise<SentRow[]> {
  if (!isUuid(recommenderId)) return []
  const params: unknown[] = [recommenderId]
  const bind = binderFor(params)
  const rows = await query<SentRow>(
    `SELECT r.id, r.recipient_user_id, r.media_type, r.movie_id, r.series_id, r.recommended_at,
            COALESCE(m.title, s.title) AS title, COALESCE(m.year, s.year) AS year,
            COALESCE(m.poster_url, s.poster_url) AS poster_url,
            COALESCE(m.genres, s.genres, '{}') AS genres
       FROM social_recommendations r
       LEFT JOIN movies m ON r.media_type = 'movie'  AND m.id = r.movie_id
       LEFT JOIN series s ON r.media_type = 'series' AND s.id = r.series_id
      WHERE r.recommender_user_id = $1::uuid
        AND r.recipient_user_id IN (${visibleConnectionsSql('$1::uuid')})
        AND CASE r.media_type
              WHEN 'movie' THEN m.id IS NOT NULL AND ${libraryScopeSql(scope, 'm', bind)}
              ELSE              s.id IS NOT NULL AND ${libraryScopeSql(scope, 's', bind)}
            END
      ORDER BY r.recommended_at DESC, r.id`,
    params
  )
  return rows.rows
}

/**
 * For one recipient: which of these titles they can open now, and which they
 * have finished — by the same two predicates the inbox and the recommend
 * dialog use, so "watched" here is exactly "left their inbox by being finished".
 */
async function recipientView(
  recipientId: string,
  rows: readonly SentRow[],
  libraries: readonly ConfiguredLibrary[]
): Promise<Map<string, { inScope: boolean; finished: boolean }>> {
  const scope = await getLibraryScopeForUser(recipientId, libraries)
  const movieIds = rows.filter((r) => r.movie_id).map((r) => r.movie_id)
  const seriesIds = rows.filter((r) => r.series_id).map((r) => r.series_id)
  const params: unknown[] = [recipientId, movieIds, seriesIds]
  const bind = binderFor(params)
  const result = await query<{ id: string; in_scope: boolean; finished: boolean }>(
    `SELECT t.id, ${libraryScopeSql(scope, 't', bind)} AS in_scope,
            ${movieFinishedSql('$1::uuid', 't.id')} AS finished
       FROM movies t WHERE t.id = ANY($2::uuid[])
     UNION ALL
     SELECT t.id, ${libraryScopeSql(scope, 't', bind)} AS in_scope,
            ${seriesFinishedSql('$1::uuid', 't.id')} AS finished
       FROM series t WHERE t.id = ANY($3::uuid[])`,
    params
  )
  return new Map(
    result.rows.map((row) => [row.id, { inScope: row.in_scope === true, finished: row.finished === true }])
  )
}

/**
 * The sender's Sent tab: one group per recipient in name order, newest first
 * inside each, with where each title stands with that person (`sentStatus`).
 * A household is a handful of people, so the per-recipient lookups run one
 * recipient at a time in parallel rather than as one clever query.
 */
export async function listSent(recommenderId: string, scope: LibraryScope): Promise<SentGroup[]> {
  const rows = await readSent(recommenderId, scope)
  if (rows.length === 0) return []

  const [connections, libraries] = await Promise.all([
    listVisibleConnections(recommenderId),
    loadConfiguredLibraries(),
  ])

  const groups = await Promise.all(
    connections.map(async (user): Promise<SentGroup | null> => {
      const theirs = rows.filter((row) => row.recipient_user_id === user.id)
      if (theirs.length === 0) return null

      const [view, watch] = await Promise.all([
        recipientView(user.id, theirs, libraries),
        // Progress only matters for a series; skip the history read without one.
        theirs.some((row) => row.media_type === 'series') ? getWatchStatusForUser(user.id) : null,
      ])
      const progressById = new Map((watch?.series ?? []).map((s) => [s.id, s]))

      return {
        recipient: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
        items: theirs.map((row): SentRecommendationItem => {
          const itemId = (row.media_type === 'movie' ? row.movie_id : row.series_id) as string
          const seen = view.get(itemId)
          const progress = row.media_type === 'series' ? progressById.get(itemId) : undefined
          const status = sentStatus({
            inScope: seen?.inScope === true,
            finished: seen?.finished === true,
            episodesWatched: progress?.watched ?? 0,
          })
          return {
            id: row.id,
            mediaType: row.media_type,
            itemId,
            title: row.title,
            year: row.year ?? null,
            posterUrl: row.poster_url,
            genres: row.genres ?? [],
            recommendedAt: row.recommended_at.toISOString(),
            status,
            // Not for a title they cannot open: rule 3 says it tells nothing.
            ...(progress && status !== 'unavailable'
              ? { progress: { watched: progress.watched, total: progress.total } }
              : {}),
          }
        }),
      }
    })
  )
  return groups.filter((group): group is SentGroup => group !== null)
}

/**
 * How many titles the Sent tab lists — the length of the same read, so the
 * sidebar's "has this person shared anything" cannot disagree with the tab.
 */
export async function countSent(recommenderId: string, scope: LibraryScope): Promise<number> {
  return (await readSent(recommenderId, scope)).length
}
