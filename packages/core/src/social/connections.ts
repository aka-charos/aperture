/**
 * Admin-managed connections between users.
 *
 * Users never manage connections themselves: an admin pairs two accounts, and
 * from then on the two see each other's watch history, recent watches and names
 * on titles, and can recommend titles to each other. The rules — what a visible
 * connection is, why the database orders a pair — are in `rules.ts`.
 *
 * Connecting and disconnecting are recorded in `permission_changes` for BOTH
 * people (field `connection`, `detail` = the other account's username): a
 * connection grants read access to someone's watch history, and every grant is
 * recorded (F-134).
 */

import { query, queryOne } from '../lib/db.js'
import {
  recordPermissionChanges,
  type PermissionActor,
  type PermissionChange,
} from '../permissionAudit.js'
import { displayNameSql, isUuid, validatePair, visibleConnectionsSql } from './rules.js'

/** A connected person as the people they are connected to see them. */
export interface ConnectedUser {
  id: string
  username: string
  displayName: string | null
  /** `displayNameSql`: the display name, or the username when it is blank. */
  name: string
  /**
   * `/api/users/${id}/avatar` — the string `SessionUser.avatarUrl` uses. Any
   * signed-in user may fetch any user's avatar; a media server with no image
   * answers 404 and MUI's Avatar falls back to its children.
   */
  avatarUrl: string
}

/** One end of a pair, for the admin: includes whether the account has access. */
export interface ConnectionEnd extends ConnectedUser {
  /** `is_enabled AND NOT provider_disabled` — the visible-connection rule. */
  hasAccess: boolean
}

export interface ConnectionPair {
  id: string
  userA: ConnectionEnd
  userB: ConnectionEnd
  /** ISO timestamp. */
  createdAt: string
  /** Username of the admin who made it; null when that account was deleted. */
  createdByName: string | null
}

/** A user id that does not name an account — the route answers 404. */
export class SocialUserNotFoundError extends Error {
  constructor() {
    super('User not found')
    this.name = 'SocialUserNotFoundError'
  }
}

export function avatarUrlFor(userId: string): string {
  return `/api/users/${userId}/avatar`
}

interface PairRow {
  id: string
  created_at: Date
  created_by_name: string | null
  a_id: string
  a_username: string
  a_display_name: string | null
  a_name: string
  a_access: boolean
  b_id: string
  b_username: string
  b_display_name: string | null
  b_name: string
  b_access: boolean
}

const PAIR_SELECT = `
  SELECT c.id, c.created_at, cb.username AS created_by_name,
         ua.id AS a_id, ua.username AS a_username, ua.display_name AS a_display_name,
         ${displayNameSql('ua')} AS a_name,
         (ua.is_enabled = true AND ua.provider_disabled = false) AS a_access,
         ub.id AS b_id, ub.username AS b_username, ub.display_name AS b_display_name,
         ${displayNameSql('ub')} AS b_name,
         (ub.is_enabled = true AND ub.provider_disabled = false) AS b_access
    FROM user_connections c
    JOIN users ua ON ua.id = c.user_id_a
    JOIN users ub ON ub.id = c.user_id_b
    LEFT JOIN users cb ON cb.id = c.created_by`

function toEnd(
  id: string,
  username: string,
  displayName: string | null,
  name: string,
  access: boolean
): ConnectionEnd {
  return { id, username, displayName, name, avatarUrl: avatarUrlFor(id), hasAccess: access === true }
}

function toPair(row: PairRow): ConnectionPair {
  return {
    id: row.id,
    userA: toEnd(row.a_id, row.a_username, row.a_display_name, row.a_name, row.a_access),
    userB: toEnd(row.b_id, row.b_username, row.b_display_name, row.b_name, row.b_access),
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
  }
}

async function getConnectionPair(id: string): Promise<ConnectionPair | null> {
  const row = await queryOne<PairRow>(`${PAIR_SELECT} WHERE c.id = $1`, [id])
  return row ? toPair(row) : null
}

/** One audit row on each person's history, naming the other. */
async function auditConnection(
  actor: PermissionActor,
  ends: Array<{ id: string; username: string }>,
  connected: boolean
): Promise<void> {
  const [first, second] = ends
  const change = (other: { username: string }): PermissionChange => ({
    field: 'connection',
    oldValue: String(!connected),
    newValue: String(connected),
    detail: other.username,
  })
  // recordPermissionChanges never throws (it logs), so the two are independent.
  await Promise.all([
    recordPermissionChanges(actor, { kind: 'user', id: first.id, label: first.username }, [change(second)]),
    recordPermissionChanges(actor, { kind: 'user', id: second.id, label: second.username }, [change(first)]),
  ])
}

/**
 * Connect two accounts. Both must exist, in any access state — setting a
 * connection up before granting access is allowed (F-135 rule 2); it stays
 * invisible to the other person until access is on.
 *
 * Idempotent: the same two people again, in either order and any letter case,
 * return the existing pair with `created: false` and record nothing.
 *
 * Throws `RangeError` (malformed id or a self-pair → 400) and
 * `SocialUserNotFoundError` (→ 404).
 */
export async function createUserConnection(
  actor: PermissionActor,
  a: string,
  b: string
): Promise<{ pair: ConnectionPair; created: boolean }> {
  const [left, right] = validatePair(a, b)

  const users = await query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE id = ANY($1::uuid[])`,
    [[left, right]]
  )
  if (users.rows.length !== 2) throw new SocialUserNotFoundError()

  // The database orders the pair: TypeScript never compares uuids (rules.ts).
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO user_connections (user_id_a, user_id_b, created_by)
     VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), $3::uuid)
     ON CONFLICT (user_id_a, user_id_b) DO NOTHING
     RETURNING id`,
    [left, right, actor.userId]
  )

  let id = inserted?.id
  if (!id) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM user_connections
        WHERE user_id_a = LEAST($1::uuid, $2::uuid) AND user_id_b = GREATEST($1::uuid, $2::uuid)`,
      [left, right]
    )
    id = existing?.id
  }
  // Only reachable if the pair was deleted between the two statements.
  if (!id) throw new SocialUserNotFoundError()

  if (inserted) await auditConnection(actor, users.rows, true)

  const pair = await getConnectionPair(id)
  if (!pair) throw new SocialUserNotFoundError()
  return { pair, created: Boolean(inserted) }
}

/** Remove a pair by its row id. False when there is no such row. */
export async function removeUserConnection(
  actor: PermissionActor,
  connectionId: string
): Promise<boolean> {
  if (!isUuid(connectionId)) return false
  const row = await queryOne<{
    a_id: string
    a_username: string
    b_id: string
    b_username: string
  }>(
    `DELETE FROM user_connections c
      USING users ua, users ub
      WHERE c.id = $1 AND ua.id = c.user_id_a AND ub.id = c.user_id_b
      RETURNING ua.id AS a_id, ua.username AS a_username, ub.id AS b_id, ub.username AS b_username`,
    [connectionId]
  )
  if (!row) return false
  await auditConnection(
    actor,
    [
      { id: row.a_id, username: row.a_username },
      { id: row.b_id, username: row.b_username },
    ],
    false
  )
  return true
}

/** Admin: every pair, both ends with their access state, newest first. */
export async function listAllConnections(): Promise<ConnectionPair[]> {
  const rows = await query<PairRow>(`${PAIR_SELECT} ORDER BY c.created_at DESC, c.id`)
  return rows.rows.map(toPair)
}

/** The viewer's visible connections (rules.ts rule 1), ordered by name. */
export async function listVisibleConnections(userId: string): Promise<ConnectedUser[]> {
  if (!isUuid(userId)) return []
  const rows = await query<{ id: string; username: string; display_name: string | null; name: string }>(
    `SELECT u.id, u.username, u.display_name, ${displayNameSql('u')} AS name
       FROM users u
      WHERE u.id IN (${visibleConnectionsSql('$1::uuid')})
      ORDER BY name, u.username`,
    [userId]
  )
  return rows.rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    name: row.name,
    avatarUrl: avatarUrlFor(row.id),
  }))
}

export async function getVisibleConnectionIds(userId: string): Promise<string[]> {
  if (!isUuid(userId)) return []
  const rows = await query<{ user_id: string }>(visibleConnectionsSql('$1::uuid'), [userId])
  return rows.rows.map((row) => row.user_id)
}

/** Whether `targetId` is a visible connection of `viewerId`. One index probe. */
export async function isVisibleConnection(viewerId: string, targetId: string): Promise<boolean> {
  if (!isUuid(viewerId) || !isUuid(targetId)) return false
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok
       FROM user_connections c
       JOIN users u ON u.id = $2::uuid
      WHERE c.user_id_a = LEAST($1::uuid, $2::uuid) AND c.user_id_b = GREATEST($1::uuid, $2::uuid)
        AND u.is_enabled = true AND u.provider_disabled = false`,
    [viewerId, targetId]
  )
  return row != null
}
