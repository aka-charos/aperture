/**
 * The rules of notifications. Pure and free of the database, so `rules.test.ts`
 * pins them without loading the pool (the `social/rules.ts` pattern).
 *
 * A notification is something that happened to one person: a connection sent
 * them a title, a request of theirs moved, someone replied on an issue they
 * reported, or their recommendations were remade. Each person chooses, per
 * event, whether it reaches them by email, by the Android app, both or neither.
 *
 * Five rules.
 *
 * 1. **Email is opt-in, the app is opt-out.** A person with no stored choice
 *    gets the app (installing it and allowing notifications is already a
 *    choice) and no email: `email_notifications_enabled` defaults to on from a
 *    time when it did nothing, so it records no consent, and the newsletter
 *    opt-in made the same call.
 *
 * 2. **Nothing is ever reported twice and nothing in the past is reported at
 *    all.** Both channels keep a cursor; a first check only sets it, so
 *    switching email on or installing the app never delivers a backlog. Each
 *    check covers `(since, until]`, and `until` trails the clock by
 *    `SETTLE_MS` so a row whose transaction started before the check but
 *    committed after it still falls inside the next window rather than
 *    between two.
 *
 * 3. **A request notifies when SOMEONE ELSE moved it.** The submit handler
 *    advances a new request seconds after creating it (and straight to
 *    approved for someone Seerr auto-approves), and telling a person what they
 *    just did is noise; `OWN_ACTION_MS` is that window.
 *
 * 4. **Email needs an address, the admin's permission and access**, checked in
 *    one place (`emailReachability`) for the job, the settings card and the
 *    admin view, so all three say the same thing.
 *
 * 5. **A phone is only what it last reported.** Android never says when an app
 *    is uninstalled, and the app checks in only while the screen is on, so a
 *    long gap means an unused phone. The one firm line is the sign-in
 *    lifetime: past `DEVICE_SIGNED_OUT_DAYS` the phone's session has expired
 *    and it cannot receive anything until its owner signs in again.
 */

import { isEmailAddress } from '../email/rules.js'

export const NOTIFICATION_EVENTS = ['watchThis', 'requests', 'issueReplies', 'recommendations'] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

export const NOTIFICATION_CHANNELS = ['email', 'app'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export interface EventPreference {
  email: boolean
  app: boolean
}

export type NotificationPreferences = Record<NotificationEvent, EventPreference>

/** Rule 1. */
export const DEFAULT_EVENT_PREFERENCE: Readonly<EventPreference> = Object.freeze({ email: false, app: true })

/** Rule 2. */
export const SETTLE_MS = 60_000

/** Rule 3. */
export const OWN_ACTION_MS = 2 * 60_000

/** Rule 5: the session's absolute lifetime (plugins/auth.ts). */
export const DEVICE_SIGNED_OUT_DAYS = 30

/** How many events one check returns or one email lists; older ones are dropped, never queued. */
export const MAX_EVENTS_PER_CHECK = 50

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === 'string' && (NOTIFICATION_EVENTS as readonly string[]).includes(value)
}

/** Stored rows over the defaults. An unknown event name is ignored rather than trusted. */
export function readPreferences(
  rows: readonly { event: string; email: boolean; app: boolean }[]
): NotificationPreferences {
  const preferences = Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [event, { ...DEFAULT_EVENT_PREFERENCE }])
  ) as NotificationPreferences
  for (const row of rows) {
    if (isNotificationEvent(row.event)) {
      preferences[row.event] = { email: row.email === true, app: row.app === true }
    }
  }
  return preferences
}

/** The events a channel is switched on for. */
export function eventsFor(preferences: NotificationPreferences, channel: NotificationChannel): NotificationEvent[] {
  return NOTIFICATION_EVENTS.filter((event) => preferences[event][channel])
}

/**
 * A PUT body read into rows to store, or the reason it is refused. Events not
 * named are left as they are; a name this build does not know is refused, since
 * storing less than was asked for reads as a saved choice that was not saved.
 */
export function parsePreferenceUpdate(
  body: unknown
): { ok: true; rows: { event: NotificationEvent; email: boolean; app: boolean }[] } | { ok: false; error: string } {
  const list = body && typeof body === 'object' ? (body as { preferences?: unknown }).preferences : undefined
  if (!Array.isArray(list)) return { ok: false, error: 'preferences must be a list' }
  const rows: { event: NotificationEvent; email: boolean; app: boolean }[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    if (!isNotificationEvent(value.event)) return { ok: false, error: `Unknown event: ${String(value.event)}` }
    if (typeof value.email !== 'boolean' || typeof value.app !== 'boolean') {
      return { ok: false, error: `email and app must be true or false for ${value.event}` }
    }
    if (seen.has(value.event)) return { ok: false, error: `${value.event} is listed twice` }
    seen.add(value.event)
    rows.push({ event: value.event, email: value.email, app: value.app })
  }
  return { ok: true, rows }
}

/** The answers to the app's first-run question. */
export const FIRST_RUN_CHOICES = ['phone', 'email', 'both', 'none'] as const
export type FirstRunChoice = (typeof FIRST_RUN_CHOICES)[number]

/** What a first-run answer sets: the same channels for every event. */
export function preferenceForChoice(choice: FirstRunChoice): EventPreference {
  return { email: choice === 'email' || choice === 'both', app: choice === 'phone' || choice === 'both' }
}

/** Rule 2: the window a check covers, or null for a first check (which only sets the cursor). */
export function checkWindow(since: Date | null, now: Date): { since: Date; until: Date } | null {
  const until = new Date(now.getTime() - SETTLE_MS)
  if (since == null || Number.isNaN(since.getTime())) return null
  // A cursor ahead of the server (a phone whose clock ran ahead wrote it, or
  // the server's clock went back) reports nothing rather than everything.
  if (since.getTime() >= until.getTime()) return { since: until, until }
  return { since, until }
}

export type RequestOutcome = 'approved' | 'declined' | 'available'

/** Rule 3: whether a request's latest status change is news to its requester. */
export function requestChangeNotifies(status: string, createdAt: Date, changedAt: Date | null): status is RequestOutcome {
  if (status !== 'approved' && status !== 'declined' && status !== 'available') return false
  if (changedAt == null) return false
  return changedAt.getTime() - createdAt.getTime() > OWN_ACTION_MS
}

export type EmailUnreachable = 'noAddress' | 'notAllowed' | 'noAccess'

/** Rule 4. `null` means email can reach this person. */
export function emailReachability(user: {
  email: string | null
  emailAllowed: boolean
  isEnabled: boolean
  providerDisabled: boolean
}): EmailUnreachable | null {
  if (!user.isEnabled || user.providerDisabled) return 'noAccess'
  if (!user.email || !isEmailAddress(user.email)) return 'noAddress'
  if (!user.emailAllowed) return 'notAllowed'
  return null
}

/** Rule 5. */
export function deviceSignedOut(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > DEVICE_SIGNED_OUT_DAYS * 24 * 60 * 60 * 1000
}

/**
 * A device check-in body, trimmed and bounded, or null when the install id is
 * not a uuid. Text fields are capped because a phone, not a person, wrote them.
 */
export function readDeviceReport(
  installId: string,
  body: unknown
): { id: string; model: string | null; androidVersion: string | null; appVersion: string | null; notificationsAllowed: boolean } | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installId)) return null
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const text = (raw: unknown) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : null)
  return {
    id: installId.toLowerCase(),
    model: text(value.model),
    androidVersion: text(value.androidVersion),
    appVersion: text(value.appVersion),
    notificationsAllowed: value.notificationsAllowed === true,
  }
}
