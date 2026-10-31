/**
 * Notifications: each person's choice of email and app per event, the phones
 * running the Android app, and the check those phones make.
 *
 * The rules are core `notifications/rules.ts`. Everything a screen needs to
 * decide is sent decided: whether email can reach this person and why not,
 * and which phones are signed out. The app column of the settings card is
 * drawn only for someone with a phone, which the card reads off `devices`.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin, requireAuth } from '../../plugins/auth.js'
import {
  NOTIFICATION_EVENTS,
  checkNotificationsForApp,
  getEmailReach,
  getNotificationPreferences,
  getNotificationReachReport,
  listUserDevices,
  parsePreferenceUpdate,
  readDeviceReport,
  recordDeviceCheckIn,
  removeUserDevice,
  setNotificationPreferences,
  type NotificationPreferences,
} from '@aperture/core'

function preferenceList(preferences: NotificationPreferences) {
  return NOTIFICATION_EVENTS.map((event) => ({ event, ...preferences[event] }))
}

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  async function settingsFor(userId: string) {
    const [preferences, email, devices] = await Promise.all([
      getNotificationPreferences(userId),
      getEmailReach(userId),
      listUserDevices(userId),
    ])
    return {
      // Whose settings these are: the app keeps its first-run answer per
      // account, so a second person signing in on a phone is asked too.
      account: userId,
      preferences: preferenceList(preferences),
      email: { reachable: email.unreachable == null, reason: email.unreachable },
      devices,
    }
  }

  /** GET /api/notifications/preferences — the caller's choices, email reach and phones. */
  fastify.get(
    '/api/notifications/preferences',
    {
      preHandler: requireAuth,
      schema: { tags: ['notifications'], description: "The caller's notification choices, whether email can reach them, and their phones." },
    },
    async (request) => settingsFor(request.user!.id)
  )

  /** PUT /api/notifications/preferences — set the events named; the rest keep their choice. */
  fastify.put(
    '/api/notifications/preferences',
    {
      preHandler: requireAuth,
      schema: { tags: ['notifications'], description: 'Set email and app notifications for the events named.' },
    },
    async (request, reply) => {
      const parsed = parsePreferenceUpdate(request.body)
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error })
      const userId = request.user!.id
      await setNotificationPreferences(userId, parsed.rows)
      return settingsFor(userId)
    }
  )

  /**
   * POST /api/notifications/check — a phone running the app reports itself
   * and asks what is new since its cursor. Without `since` it only gets a
   * cursor, so a new install is never handed a backlog. A cursor is one
   * account's: `sinceAccount` names it, and a cursor from someone else who
   * signed in on the phone counts as none.
   */
  fastify.post<{ Body: { installId?: string; since?: string; sinceAccount?: string } & Record<string, unknown> }>(
    '/api/notifications/check',
    {
      preHandler: requireAuth,
      schema: { tags: ['notifications'], description: "The Android app's check-in: records the phone and returns new notifications." },
    },
    async (request, reply) => {
      const body = request.body ?? {}
      const report = readDeviceReport(String(body.installId ?? ''), body)
      if (!report) return reply.status(400).send({ error: 'installId must be a uuid' })
      const userId = request.user!.id
      await recordDeviceCheckIn(userId, report)
      const ownCursor = typeof body.since === 'string' && body.sinceAccount === userId
      const since = ownCursor ? new Date(body.since as string) : null
      const check = await checkNotificationsForApp(userId, since && !Number.isNaN(since.getTime()) ? since : null)
      return { account: userId, ...check }
    }
  )

  /** DELETE /api/notifications/devices/:id — the owner forgets one of their phones. */
  fastify.delete<{ Params: { id: string } }>(
    '/api/notifications/devices/:id',
    {
      preHandler: requireAuth,
      schema: { tags: ['notifications'], description: 'Forget one of the caller’s phones.' },
    },
    async (request, reply) => {
      const removed = await removeUserDevice(request.user!.id, request.params.id)
      if (!removed) return reply.status(404).send({ error: 'Phone not found' })
      return { removed: true }
    }
  )

  /** GET /api/notifications/reach — every account's email reach, chosen events and phones. */
  fastify.get(
    '/api/notifications/reach',
    {
      preHandler: requireAdmin,
      schema: { tags: ['notifications'], description: 'How each account can be notified, for the Users page.' },
    },
    async () => getNotificationReachReport()
  )
}

export default notificationRoutes
