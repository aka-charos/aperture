/**
 * Per-user capabilities — the one place a feature permission is decided.
 *
 * A permission on this app is a boolean column on `users`, and until this
 * module existed every route answered it for itself: seventeen copies of
 * `SELECT discover_enabled FROM users WHERE id = $1`, a private helper in the
 * watch-history handler, and one lone `!isAdmin && !collectionsEnabled` for
 * Collections. Three spellings of one question, none of them pinned, each a
 * round trip to the database for a value the session had already loaded.
 *
 * That is the shape `watchedExclusion.ts`, `pending.ts` and `countryMatch.ts`
 * exist to prevent, and it had already gone wrong here: the rule that Content
 * Requests need Discover lived only in the browser (`pages/Users.tsx`), so the
 * API would write the two columns independently and `routes/seerr` would let a
 * user with Discover switched off file requests anyway.
 *
 * Three rules.
 *
 * 1. **A capability is granted from the SESSION, never from a fresh read.**
 *    Every flag rides on `SessionUser`, so a check costs nothing and cannot be
 *    skipped for being expensive. It also means one query decides a request's
 *    permissions, rather than each handler deciding from a row that may have
 *    changed between two of them.
 *
 * 2. **A dependency between flags is expressed HERE, and enforced at the
 *    write too.** `can()` is what a route asks, so the dependency holds even
 *    over a row written before the rule existed; `discoverRequestSql` keeps
 *    new rows from entering that state at all. Either alone leaves one of the
 *    two halves — a stale row, or a route that trusts the column — wrong.
 *
 * 3. **Admin override is declared per capability, never assumed.** An admin
 *    bypasses Collections and watch-history management, and deliberately does
 *    NOT bypass Discover: an admin with Discover switched off has always been
 *    refused by those routes, and quietly granting it here would be a change
 *    of behaviour wearing a refactor's clothes.
 *
 * Movies and Series are not capabilities. Nothing in the HTTP layer reads
 * them — they gate background work (`StrmWriter`, both recommender pipelines)
 * through SQL of their own — and a capability nothing enforces is a promise
 * this module cannot keep.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'

/** Every permission flag a capability can be decided from. */
export interface PermissionSubject {
  isAdmin: boolean
  discoverEnabled: boolean
  discoverRequestEnabled: boolean
  collectionsEnabled: boolean
  canManageWatchHistory: boolean
  emailNotificationsAllowed: boolean
}

export const CAPABILITIES = [
  'discover',
  'discover:request',
  'collections',
  'watchHistory:manage',
  'emailNotifications',
] as const

export type Capability = (typeof CAPABILITIES)[number]

interface CapabilityRule {
  /** The grant itself, from the flags alone. Admin is applied by `can`. */
  granted: (subject: PermissionSubject) => boolean
  /** Whether `is_admin` grants this capability regardless of the flags. */
  adminOverride: boolean
  /**
   * The 403 body. Kept per capability rather than generic because these
   * strings are what the user reads, and every one of them already existed at
   * the call sites this module replaced — a generic "Forbidden" would be a
   * regression in the only part of this a user ever sees.
   */
  refusal: { error: string; message?: string }
}

const RULES: Record<Capability, CapabilityRule> = {
  discover: {
    granted: (s) => s.discoverEnabled,
    adminOverride: false,
    refusal: {
      error: 'Discovery not enabled for your account',
      message: 'Contact your admin to enable discovery suggestions',
    },
  },

  /**
   * Requesting missing content through Seerr.
   *
   * Requires Discover as well as the request flag. A request is made from the
   * Discover surface and is scored by the discovery pipeline — which skips a
   * user with `discover_enabled` false outright — so the pair has never been
   * meaningful, and the admin UI has always cleared one with the other. The
   * dependency lives here so a row that predates `discoverRequestSql`, or one
   * written by any other path, still cannot spend someone's Seerr quota.
   */
  'discover:request': {
    granted: (s) => s.discoverRequestEnabled && s.discoverEnabled,
    adminOverride: false,
    refusal: {
      error: 'Content requests not enabled for your account',
      message: 'Contact your admin to enable content requests',
    },
  },

  collections: {
    granted: (s) => s.collectionsEnabled,
    adminOverride: true,
    refusal: { error: 'Collections are not enabled for your account' },
  },

  /**
   * Editing one's own watch history (marking played, setting a date).
   *
   * The handlers that read this run `requireSelfOrAdmin` first, so a
   * non-admin only ever reaches it for their own row — which is why asking the
   * caller's flag is the same question as the target's, minus a query.
   */
  'watchHistory:manage': {
    granted: (s) => s.canManageWatchHistory,
    adminOverride: true,
    refusal: { error: 'Watch history management is not enabled for this user' },
  },

  emailNotifications: {
    granted: (s) => s.emailNotificationsAllowed,
    adminOverride: false,
    refusal: {
      error: 'Email notifications have not been enabled for this account by an administrator',
    },
  },
}

/** Whether this user holds a capability. Pure. */
export function can(subject: PermissionSubject, capability: Capability): boolean {
  const rule = RULES[capability]
  if (rule.adminOverride && subject.isAdmin) return true
  return rule.granted(subject)
}

/** The 403 body for a capability, so a refusal reads the same wherever it is sent. */
export function refusalFor(capability: Capability): { error: string; message?: string } {
  return { ...RULES[capability].refusal }
}

/**
 * A `preHandler` refusing anyone without the capability.
 *
 * Composed after `requireAuth` rather than replacing it: an unauthenticated
 * caller gets 401, not a 403 naming a feature they might not even have an
 * account for.
 */
export function requireCapability(capability: Capability) {
  return async function capabilityGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    if (!can(request.user, capability)) {
      return reply.status(403).send(refusalFor(capability))
    }
  }
}

/**
 * The `users` columns a capability is decided from, for the rare caller that
 * must ask about a user other than the one making the request.
 *
 * Most permissions are the caller's and ride on the session. A few belong to
 * the TARGET of an admin action — whether email notifications are permitted
 * for the account being edited, say — and an admin must not grant one of those
 * by being an admin. Those read the row, through this, and get the same
 * `can()` as everyone else rather than a bare column test.
 */
export const PERMISSION_COLUMNS = `is_admin, discover_enabled, discover_request_enabled,
       collections_enabled, can_manage_watch_history, email_notifications_allowed`

/** A row selected with `PERMISSION_COLUMNS`. */
export interface PermissionRow {
  is_admin: boolean
  discover_enabled: boolean
  discover_request_enabled: boolean
  collections_enabled: boolean
  can_manage_watch_history: boolean
  email_notifications_allowed: boolean
}

export function toPermissionSubject(row: PermissionRow): PermissionSubject {
  return {
    isAdmin: row.is_admin,
    discoverEnabled: row.discover_enabled,
    discoverRequestEnabled: row.discover_request_enabled,
    collectionsEnabled: row.collections_enabled,
    canManageWatchHistory: row.can_manage_watch_history,
    emailNotificationsAllowed: row.email_notifications_allowed,
  }
}

/**
 * `discover_request_enabled` as an UPDATE of `users` must write it.
 *
 * Same mechanism, and the same reason, as `accountEnabledSql`: every
 * expression in one UPDATE's SET list reads the row as it was BEFORE the
 * statement, so a column the statement also writes has to be given its new
 * value here (normally its bind parameter). The bare column would read the old
 * value and the dependency would hold one save late — exactly long enough for
 * the request that turned Discover off to leave request rights standing.
 *
 * Called whenever either column is written, which is why switching Discover
 * off clears request rights without the caller having to remember to.
 */
export function discoverRequestSql(
  written: { discover_enabled?: string; discover_request_enabled?: string } = {}
): string {
  const request = written.discover_request_enabled ?? 'discover_request_enabled'
  const discover = written.discover_enabled ?? 'discover_enabled'
  return `(${request} AND ${discover})`
}
