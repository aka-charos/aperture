/**
 * The app channel: a phone asks what is new since its own cursor. The phone
 * keeps the cursor, so two phones of one person each get every event once.
 */
import { resolveEffectiveUiLanguage } from '../lib/userSettings.js'
import { collectNotifications, type NotificationItem } from './events.js'
import { SETTLE_MS, checkWindow, eventsFor } from './rules.js'
import { getNotificationPreferences } from './store.js'

export interface AppCheck {
  /** Send this back as `since` next time. */
  cursor: string
  /** Empty on a first check, which only sets the cursor. */
  items: NotificationItem[]
}

export async function checkNotificationsForApp(userId: string, since: Date | null, now = new Date()): Promise<AppCheck> {
  const window = checkWindow(since, now)
  if (!window) return { cursor: new Date(now.getTime() - SETTLE_MS).toISOString(), items: [] }
  const events = eventsFor(await getNotificationPreferences(userId), 'app')
  if (events.length === 0) return { cursor: window.until.toISOString(), items: [] }
  const items = await collectNotifications(userId, events, window, await resolveEffectiveUiLanguage(userId))
  return { cursor: window.until.toISOString(), items }
}
