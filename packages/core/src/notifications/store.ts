/**
 * Notification preferences, the phones running the app, and the admin's view
 * of how each person can be reached.
 */
import { query, transaction } from '../lib/db.js'
import {
  NOTIFICATION_EVENTS,
  deviceSignedOut,
  emailReachability,
  readPreferences,
  type EmailUnreachable,
  type NotificationEvent,
  type NotificationPreferences,
} from './rules.js'

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const rows = await query<{ event: string; email: boolean; app: boolean }>(
    `SELECT event, email, app FROM user_notification_preferences WHERE user_id = $1`,
    [userId]
  )
  return readPreferences(rows.rows)
}

/** Stores the events named; the rest keep what they had. Unchanged rows are not rewritten. */
export async function setNotificationPreferences(
  userId: string,
  rows: readonly { event: NotificationEvent; email: boolean; app: boolean }[]
): Promise<NotificationPreferences> {
  if (rows.length > 0) {
    await transaction(async (client) => {
      for (const row of rows) {
        await client.query(
          `INSERT INTO user_notification_preferences (user_id, event, email, app)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, event) DO UPDATE
             SET email = EXCLUDED.email, app = EXCLUDED.app, updated_at = NOW()
             WHERE user_notification_preferences.email IS DISTINCT FROM EXCLUDED.email
                OR user_notification_preferences.app IS DISTINCT FROM EXCLUDED.app`,
          [userId, row.event, row.email, row.app]
        )
      }
    })
  }
  return getNotificationPreferences(userId)
}

export interface AppDevice {
  id: string
  model: string | null
  androidVersion: string | null
  appVersion: string | null
  notificationsAllowed: boolean
  firstSeenAt: string
  lastSeenAt: string
  /** Past the sign-in lifetime: this phone receives nothing until its owner signs in again. */
  signedOut: boolean
}

interface DeviceRow {
  id: string
  user_id: string
  model: string | null
  android_version: string | null
  app_version: string | null
  notifications_allowed: boolean
  first_seen_at: Date
  last_seen_at: Date
}

function toDevice(row: DeviceRow, now: Date): AppDevice {
  return {
    id: row.id,
    model: row.model,
    androidVersion: row.android_version,
    appVersion: row.app_version,
    notificationsAllowed: row.notifications_allowed === true,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    signedOut: deviceSignedOut(row.last_seen_at, now),
  }
}

/**
 * A phone checking in. The install id is the key, so the same phone signed in
 * as someone else moves to them instead of appearing twice.
 */
export async function recordDeviceCheckIn(
  userId: string,
  report: { id: string; model: string | null; androidVersion: string | null; appVersion: string | null; notificationsAllowed: boolean }
): Promise<void> {
  await query(
    `INSERT INTO app_devices (id, user_id, model, android_version, app_version, notifications_allowed)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           model = COALESCE(EXCLUDED.model, app_devices.model),
           android_version = COALESCE(EXCLUDED.android_version, app_devices.android_version),
           app_version = COALESCE(EXCLUDED.app_version, app_devices.app_version),
           notifications_allowed = EXCLUDED.notifications_allowed,
           first_seen_at = CASE WHEN app_devices.user_id = EXCLUDED.user_id
                                THEN app_devices.first_seen_at ELSE NOW() END,
           last_seen_at = NOW()`,
    [report.id, userId, report.model, report.androidVersion, report.appVersion, report.notificationsAllowed]
  )
}

export async function listUserDevices(userId: string, now = new Date()): Promise<AppDevice[]> {
  const rows = await query<DeviceRow>(
    `SELECT * FROM app_devices WHERE user_id = $1 ORDER BY last_seen_at DESC, id`,
    [userId]
  )
  return rows.rows.map((row) => toDevice(row, now))
}

/** The owner forgets a phone. False for a phone that is missing or someone else's, alike. */
export async function removeUserDevice(userId: string, deviceId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return false
  const result = await query(`DELETE FROM app_devices WHERE id = $1 AND user_id = $2`, [deviceId.toLowerCase(), userId])
  return (result.rowCount ?? 0) > 0
}

export interface EmailReach {
  /** Null when email can reach this person; otherwise why not. */
  unreachable: EmailUnreachable | null
  address: string | null
}

interface ReachUserRow {
  id: string
  email: string | null
  email_notifications_allowed: boolean | null
  is_enabled: boolean
  provider_disabled: boolean | null
}

function emailReachFor(row: ReachUserRow): EmailReach {
  return {
    address: row.email,
    unreachable: emailReachability({
      email: row.email,
      emailAllowed: row.email_notifications_allowed === true,
      isEnabled: row.is_enabled === true,
      providerDisabled: row.provider_disabled === true,
    }),
  }
}

export async function getEmailReach(userId: string): Promise<EmailReach> {
  const rows = await query<ReachUserRow>(
    `SELECT id, email, email_notifications_allowed, is_enabled, provider_disabled FROM users WHERE id = $1`,
    [userId]
  )
  const row = rows.rows[0]
  return row ? emailReachFor(row) : { address: null, unreachable: 'noAccess' }
}

export interface NotificationReach {
  userId: string
  email: EmailReach
  emailEvents: NotificationEvent[]
  appEvents: NotificationEvent[]
  devices: AppDevice[]
}

/**
 * Every account's email reach, chosen events and phones, for the admin's
 * Users page. `anyDevices` is false until a phone has ever checked in, which is
 * what keeps the app out of sight on an instance nobody runs it on.
 */
export async function getNotificationReachReport(now = new Date()): Promise<{ anyDevices: boolean; users: NotificationReach[] }> {
  const [users, preferences, devices] = await Promise.all([
    query<ReachUserRow>(`SELECT id, email, email_notifications_allowed, is_enabled, provider_disabled FROM users`),
    query<{ user_id: string; event: string; email: boolean; app: boolean }>(
      `SELECT user_id, event, email, app FROM user_notification_preferences`
    ),
    query<DeviceRow>(`SELECT * FROM app_devices ORDER BY last_seen_at DESC, id`),
  ])

  const preferenceRows = new Map<string, { event: string; email: boolean; app: boolean }[]>()
  for (const row of preferences.rows) {
    const list = preferenceRows.get(row.user_id) ?? []
    list.push(row)
    preferenceRows.set(row.user_id, list)
  }
  const deviceRows = new Map<string, AppDevice[]>()
  for (const row of devices.rows) {
    const list = deviceRows.get(row.user_id) ?? []
    list.push(toDevice(row, now))
    deviceRows.set(row.user_id, list)
  }

  return {
    anyDevices: devices.rows.length > 0,
    users: users.rows.map((row) => {
      const chosen = readPreferences(preferenceRows.get(row.id) ?? [])
      return {
        userId: row.id,
        email: emailReachFor(row),
        emailEvents: NOTIFICATION_EVENTS.filter((event) => chosen[event].email),
        appEvents: NOTIFICATION_EVENTS.filter((event) => chosen[event].app),
        devices: deviceRows.get(row.id) ?? [],
      }
    }),
  }
}
