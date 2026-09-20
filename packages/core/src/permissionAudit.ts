/**
 * A record of every permission that changed, who changed it, and when.
 *
 * Permissions here are ten booleans on `users` plus an API key's scopes, and
 * until this existed nothing wrote down a single change to any of them. The
 * question that has no answer without it is the ordinary one — "I could do this
 * yesterday" — and the answers are all indistinguishable from the outside: an
 * admin unticked a switch, the user sync saw `Policy.IsDisabled` flip on the
 * media server, a derived column followed a switch the admin did tick
 * (`is_enabled`, `discover_request_enabled`), or a key was narrowed.
 *
 * Five rules.
 *
 * 1. **The row is diffed, never the request.** Callers pass the permissions
 *    BEFORE and AFTER their write, so what gets recorded is what actually
 *    changed — including the derived columns, which are the ones nobody
 *    remembers touching. A recorder fed the request body would report that the
 *    admin unticked Discover and miss that request rights went with it.
 *
 * 2. **Only real changes are stored.** The user sync runs on a schedule and
 *    rewrites the same values indefinitely; recording no-ops would bury the
 *    handful of rows that matter and make the table grow with the clock rather
 *    than with events. Nothing prunes, and nothing needs to.
 *
 * 3. **A creation records GRANTS only.** An account imported with everything
 *    off has granted nothing, and the interesting half of an import is which
 *    switches came on with it.
 *
 * 4. **It never fails the write.** A permission change that succeeded must not
 *    be reported as failed because the audit insert did, so every path swallows
 *    and logs. The audit is evidence, not a participant.
 *
 * 5. **Labels are stored, not just ids.** `subject_id` carries no foreign key
 *    on purpose: the record of an account's permissions has to outlive the
 *    account, and a cascade would delete exactly the history somebody is asking
 *    about. The username at the time is stored beside the id so a deleted user
 *    is still identifiable.
 */

import { query } from './lib/db.js'
import { createChildLogger } from './lib/logger.js'

const logger = createChildLogger('permission-audit')

/**
 * The `users` columns that are permissions.
 *
 * Deliberately not "every boolean on the table": `email_notifications_enabled`
 * is the user's own preference and `email_locked` is a sync detail. A column
 * belongs here when an admin granting or revoking it changes what somebody can
 * do.
 */
export const AUDITED_USER_PERMISSIONS = [
  'is_admin',
  'is_enabled',
  'provider_disabled',
  'movies_enabled',
  'series_enabled',
  'discover_enabled',
  'discover_request_enabled',
  'collections_enabled',
  'can_manage_watch_history',
  'email_notifications_allowed',
  'ai_explanation_override_allowed',
] as const

export type AuditedUserPermission = (typeof AUDITED_USER_PERMISSIONS)[number]

/** The audited columns, for a SELECT. */
export const PERMISSION_AUDIT_COLUMNS = AUDITED_USER_PERMISSIONS.join(', ')

/** A row selected with `PERMISSION_AUDIT_COLUMNS`. Absent columns read as false. */
export type UserPermissionSnapshot = Partial<Record<AuditedUserPermission, boolean | null>>

/**
 * Who made the change.
 *
 * `userId` is null when nobody did — the user sync reading the media server,
 * or the login route clearing `provider_disabled`. `label` is what a reader
 * sees, so it names a person or names the machinery.
 */
export interface PermissionActor {
  userId: string | null
  label: string
}

export const SYSTEM_ACTORS = {
  userSync: { userId: null, label: 'user sync' },
  login: { userId: null, label: 'media server login' },
  setupWizard: { userId: null, label: 'setup wizard' },
} as const satisfies Record<string, PermissionActor>

export interface PermissionSubject {
  kind: 'user' | 'api_key'
  id: string
  /** Username, or the key's name. Stored so a deleted subject stays readable. */
  label: string
}

export interface PermissionChange {
  field: string
  oldValue: string | null
  newValue: string
}

/**
 * What changed between two snapshots of a user's permissions.
 *
 * Pure. `before` null means the row was created, which records grants only
 * (rule 3). A column absent from either side is read as false, since that is
 * what an unselected boolean column means for every caller here.
 */
export function diffUserPermissions(
  before: UserPermissionSnapshot | null,
  after: UserPermissionSnapshot
): PermissionChange[] {
  const changes: PermissionChange[] = []

  for (const field of AUDITED_USER_PERMISSIONS) {
    const now = after[field] === true

    if (before === null) {
      if (now) changes.push({ field, oldValue: null, newValue: 'true' })
      continue
    }

    const was = before[field] === true
    if (was !== now) {
      changes.push({ field, oldValue: String(was), newValue: String(now) })
    }
  }

  return changes
}

/**
 * What changed between two scope lists. Order-insensitive: the lists are
 * normalized into a fixed order before they are stored, but a caller comparing
 * a stored list against a requested one has no such guarantee.
 */
export function diffApiKeyScopes(
  before: readonly string[] | null,
  after: readonly string[]
): PermissionChange[] {
  const show = (scopes: readonly string[]) => [...scopes].sort().join(',')
  const was = before === null ? null : show(before)
  const now = show(after)
  if (was === now) return []
  return [{ field: 'scopes', oldValue: was, newValue: now }]
}

/**
 * Store a set of changes. Best effort: logs and returns on failure.
 *
 * One statement for the whole set, so a save that flips three switches is
 * three rows written together or none — a partial audit of one action is
 * worse than none, because it reads as a complete account of it.
 */
export async function recordPermissionChanges(
  actor: PermissionActor,
  subject: PermissionSubject,
  changes: PermissionChange[]
): Promise<void> {
  if (changes.length === 0) return

  try {
    await query(
      `INSERT INTO permission_changes
         (actor_user_id, actor_label, subject_kind, subject_id, subject_label, field, old_value, new_value)
       SELECT $1, $2, $3, $4, $5, c.field, c.old_value, c.new_value
         FROM UNNEST($6::text[], $7::text[], $8::text[]) AS c(field, old_value, new_value)`,
      [
        actor.userId,
        actor.label,
        subject.kind,
        subject.id,
        subject.label,
        changes.map((c) => c.field),
        changes.map((c) => c.oldValue),
        changes.map((c) => c.newValue),
      ]
    )
  } catch (err) {
    // Rule 4: the permission change itself already happened and succeeded.
    logger.error({ err, subject: subject.id, fields: changes.map((c) => c.field) },
      'Failed to record permission changes')
  }
}

/** Read a user's audited permissions, for the before/after diff. */
export async function readUserPermissions(
  userId: string
): Promise<UserPermissionSnapshot | null> {
  const rows = await query<UserPermissionSnapshot>(
    `SELECT ${PERMISSION_AUDIT_COLUMNS} FROM users WHERE id = $1`,
    [userId]
  )
  return rows.rows[0] ?? null
}

/**
 * Record a user permission change from a before/after pair. The shape every
 * caller wants, so none of them has to remember to diff first.
 */
export async function auditUserPermissions(
  actor: PermissionActor,
  subject: PermissionSubject,
  before: UserPermissionSnapshot | null,
  after: UserPermissionSnapshot
): Promise<void> {
  await recordPermissionChanges(actor, subject, diffUserPermissions(before, after))
}

export interface PermissionChangeRecord {
  id: string
  createdAt: Date
  actorUserId: string | null
  actorLabel: string
  subjectKind: 'user' | 'api_key'
  subjectId: string
  subjectLabel: string
  field: string
  oldValue: string | null
  newValue: string
}

interface PermissionChangeRow {
  id: string
  created_at: Date
  actor_user_id: string | null
  actor_label: string
  subject_kind: 'user' | 'api_key'
  subject_id: string
  subject_label: string
  field: string
  old_value: string | null
  new_value: string
}

/**
 * The history for one subject, newest first.
 *
 * Scoped to a subject rather than offered as a whole-table listing: the
 * question this answers is always about somebody in particular, and a global
 * feed would need paging, filters and a page to put it on before it answered
 * anything the per-subject view does not.
 */
export async function getPermissionHistory(
  subjectId: string,
  limit = 50
): Promise<PermissionChangeRecord[]> {
  const rows = await query<PermissionChangeRow>(
    `SELECT id, created_at, actor_user_id, actor_label, subject_kind, subject_id,
            subject_label, field, old_value, new_value
       FROM permission_changes
      WHERE subject_id = $1
      ORDER BY created_at DESC, field ASC
      LIMIT $2`,
    [subjectId, Math.min(Math.max(limit, 1), 200)]
  )

  return rows.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    actorLabel: row.actor_label,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    subjectLabel: row.subject_label,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
  }))
}
