/**
 * Newsletters, send groups and the opt-in, in the database.
 *
 * Rules live in ./audience.ts and ./document.ts; this module reads and writes.
 */
import { query, queryOne } from '../lib/db.js'
import { resolveUiLanguage } from '../lib/languagePreference.js'
import { getSystemLanguageDefaults } from '../settings/systemSettings.js'
import {
  readGroupRules,
  type AudienceUser,
  type GroupDefinition,
  type GroupRules,
  type MemberMode,
} from './audience.js'

// ------------------------------------------------------------------ audience

/**
 * Every account with what the audience rules read, languages resolved in one
 * pass (the per-user resolver costs two queries a person; this is one).
 */
export async function loadAudienceUsers(): Promise<AudienceUser[]> {
  const [rows, defaults] = await Promise.all([
    query<{
      id: string
      username: string
      display_name: string | null
      email: string | null
      is_admin: boolean
      is_enabled: boolean
      provider_disabled: boolean
      newsletter_opt_in: boolean
      ui_language: string | null
    }>(
      `SELECT u.id, u.username, u.display_name, u.email, u.is_admin, u.is_enabled,
              u.provider_disabled, u.newsletter_opt_in,
              us.settings_json->'ui'->>'uiLanguage' AS ui_language
         FROM users u
         LEFT JOIN user_settings us ON us.user_id = u.id
        ORDER BY u.username, u.id`
    ),
    getSystemLanguageDefaults(),
  ])
  return rows.rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    isAdmin: row.is_admin === true,
    isEnabled: row.is_enabled === true,
    providerDisabled: row.provider_disabled === true,
    optedIn: row.newsletter_opt_in === true,
    language: resolveUiLanguage(row.ui_language, defaults),
  }))
}

// -------------------------------------------------------------------- groups

export interface NewsletterGroup {
  id: string
  name: string
  description: string
  rules: GroupRules
  createdAt: string
  updatedAt: string
}

interface GroupRow {
  id: string
  name: string
  description: string
  rules: unknown
  created_at: Date
  updated_at: Date
}

function toGroup(row: GroupRow): NewsletterGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rules: readGroupRules(row.rules),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function listNewsletterGroups(): Promise<NewsletterGroup[]> {
  const rows = await query<GroupRow>(`SELECT * FROM newsletter_groups ORDER BY lower(name), id`)
  return rows.rows.map(toGroup)
}

export async function getNewsletterGroup(id: string): Promise<NewsletterGroup | null> {
  const row = await queryOne<GroupRow>(`SELECT * FROM newsletter_groups WHERE id = $1`, [id])
  return row ? toGroup(row) : null
}

export async function createNewsletterGroup(input: {
  name: string
  description: string
  rules: GroupRules
}): Promise<NewsletterGroup> {
  const row = await queryOne<GroupRow>(
    `INSERT INTO newsletter_groups (name, description, rules) VALUES ($1, $2, $3) RETURNING *`,
    [input.name, input.description, JSON.stringify(input.rules)]
  )
  return toGroup(row!)
}

export async function updateNewsletterGroup(
  id: string,
  input: { name: string; description: string; rules: GroupRules }
): Promise<NewsletterGroup | null> {
  const row = await queryOne<GroupRow>(
    `UPDATE newsletter_groups SET name = $2, description = $3, rules = $4, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, input.name, input.description, JSON.stringify(input.rules)]
  )
  return row ? toGroup(row) : null
}

export async function deleteNewsletterGroup(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM newsletter_groups WHERE id = $1`, [id])
  // A draft that pointed at it no longer does; a sent newsletter keeps the id
  // as history of what it was sent to.
  await query(`UPDATE newsletters SET group_ids = array_remove(group_ids, $1) WHERE status IN ('draft', 'failed')`, [id])
  return (result.rowCount ?? 0) > 0
}

/** userId → mode, for one group. */
export async function getGroupMemberModes(groupId: string): Promise<Map<string, MemberMode>> {
  const rows = await query<{ user_id: string; mode: MemberMode }>(
    `SELECT user_id, mode FROM newsletter_group_members WHERE group_id = $1`,
    [groupId]
  )
  return new Map(rows.rows.map((row) => [row.user_id, row.mode]))
}

/** Add someone by hand, leave them out by hand, or (null) let the rules decide. */
export async function setGroupMemberMode(groupId: string, userId: string, mode: MemberMode | null): Promise<void> {
  if (mode === null) {
    await query(`DELETE FROM newsletter_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, userId])
    return
  }
  await query(
    `INSERT INTO newsletter_group_members (group_id, user_id, mode) VALUES ($1, $2, $3)
     ON CONFLICT (group_id, user_id) DO UPDATE SET mode = EXCLUDED.mode`,
    [groupId, userId, mode]
  )
  await query(`UPDATE newsletter_groups SET updated_at = NOW() WHERE id = $1`, [groupId])
}

/** The groups with their rules and hand-picked members, for resolving an audience. */
export async function loadGroupDefinitions(groupIds: readonly string[]): Promise<GroupDefinition[]> {
  if (groupIds.length === 0) return []
  const [groups, members] = await Promise.all([
    query<{ id: string; rules: unknown }>(`SELECT id, rules FROM newsletter_groups WHERE id = ANY($1::uuid[])`, [
      groupIds,
    ]),
    query<{ group_id: string; user_id: string; mode: MemberMode }>(
      `SELECT group_id, user_id, mode FROM newsletter_group_members WHERE group_id = ANY($1::uuid[])`,
      [groupIds]
    ),
  ])
  return groups.rows.map((group) => ({
    id: group.id,
    rules: readGroupRules(group.rules),
    members: new Map(members.rows.filter((m) => m.group_id === group.id).map((m) => [m.user_id, m.mode])),
  }))
}

// --------------------------------------------------------------- newsletters

export type NewsletterStatus = 'draft' | 'sending' | 'sent' | 'failed'

export interface Newsletter {
  id: string
  subject: string
  preheader: string
  content: unknown
  groupIds: string[]
  status: NewsletterStatus
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  sendStartedAt: string | null
  sentAt: string | null
  recipientCount: number | null
  sentCount: number
  failedCount: number
  lastError: string | null
}

interface NewsletterRow {
  id: string
  subject: string
  preheader: string
  content: unknown
  group_ids: string[]
  status: NewsletterStatus
  created_by: string | null
  created_by_name: string | null
  created_at: Date
  updated_at: Date
  send_started_at: Date | null
  sent_at: Date | null
  recipient_count: number | null
  sent_count: number
  failed_count: number
  last_error: string | null
}

const NEWSLETTER_SELECT = `SELECT n.*, COALESCE(u.display_name, u.username) AS created_by_name
  FROM newsletters n LEFT JOIN users u ON u.id = n.created_by`

function toNewsletter(row: NewsletterRow): Newsletter {
  return {
    id: row.id,
    subject: row.subject,
    preheader: row.preheader,
    content: row.content,
    groupIds: row.group_ids ?? [],
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    sendStartedAt: row.send_started_at?.toISOString() ?? null,
    sentAt: row.sent_at?.toISOString() ?? null,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
  }
}

export async function listNewsletters(): Promise<Newsletter[]> {
  const rows = await query<NewsletterRow>(`${NEWSLETTER_SELECT} ORDER BY n.updated_at DESC, n.id`)
  return rows.rows.map(toNewsletter)
}

export async function getNewsletter(id: string): Promise<Newsletter | null> {
  const row = await queryOne<NewsletterRow>(`${NEWSLETTER_SELECT} WHERE n.id = $1`, [id])
  return row ? toNewsletter(row) : null
}

export interface NewsletterDraft {
  subject: string
  preheader: string
  content: unknown
  groupIds: string[]
}

export async function createNewsletter(draft: NewsletterDraft, createdBy: string): Promise<Newsletter> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO newsletters (subject, preheader, content, group_ids, created_by)
     VALUES ($1, $2, $3, $4::uuid[], $5) RETURNING id`,
    [draft.subject, draft.preheader, JSON.stringify(draft.content), draft.groupIds, createdBy]
  )
  return (await getNewsletter(row!.id))!
}

/**
 * Save a draft. Only a draft, or a failed send that reached NOBODY, can change:
 * once anyone was sent it, a retry must send the rest the same newsletter, and
 * what was sent is history. Answers null when there is nothing editable by that id.
 */
export async function updateNewsletter(id: string, draft: NewsletterDraft): Promise<Newsletter | null> {
  const row = await queryOne<{ id: string }>(
    `UPDATE newsletters SET subject = $2, preheader = $3, content = $4, group_ids = $5::uuid[], updated_at = NOW()
      WHERE id = $1 AND (status = 'draft' OR (status = 'failed' AND sent_count = 0)) RETURNING id`,
    [id, draft.subject, draft.preheader, JSON.stringify(draft.content), draft.groupIds]
  )
  return row ? getNewsletter(row.id) : null
}

/** Delete anything but a send in progress. */
export async function deleteNewsletter(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM newsletters WHERE id = $1 AND status <> 'sending'`, [id])
  return (result.rowCount ?? 0) > 0
}

export interface NewsletterDelivery {
  userId: string | null
  username: string | null
  email: string
  language: string
  status: 'sent' | 'failed'
  error: string | null
  sentAt: string
}

export async function listNewsletterDeliveries(newsletterId: string): Promise<NewsletterDelivery[]> {
  const rows = await query<{
    user_id: string | null
    username: string | null
    email: string
    language: string
    status: 'sent' | 'failed'
    error: string | null
    sent_at: Date
  }>(
    `SELECT d.user_id, COALESCE(u.display_name, u.username) AS username, d.email, d.language,
            d.status, d.error, d.sent_at
       FROM newsletter_deliveries d LEFT JOIN users u ON u.id = d.user_id
      WHERE d.newsletter_id = $1
      ORDER BY d.status DESC, d.sent_at, d.id`,
    [newsletterId]
  )
  return rows.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    email: row.email,
    language: row.language,
    status: row.status,
    error: row.error,
    sentAt: row.sent_at.toISOString(),
  }))
}

// ------------------------------------------------------------------- opt-in

export interface NewsletterSubscription {
  optedIn: boolean
  email: string | null
}

export async function getNewsletterSubscription(userId: string): Promise<NewsletterSubscription | null> {
  const row = await queryOne<{ newsletter_opt_in: boolean; email: string | null }>(
    `SELECT newsletter_opt_in, email FROM users WHERE id = $1`,
    [userId]
  )
  return row ? { optedIn: row.newsletter_opt_in === true, email: row.email } : null
}

/**
 * The person's own choice. Never called on someone else's behalf: subscribing
 * is the one thing an admin may not do for a viewer (see the route).
 */
export async function setNewsletterOptIn(userId: string, optedIn: boolean): Promise<void> {
  // Not `updated_at`: the opt-in is not account data anything downstream
  // re-reads, and leaving the stamp alone keeps it out of every "changed since".
  await query(`UPDATE users SET newsletter_opt_in = $2 WHERE id = $1`, [userId, optedIn])
}

/** Who an unsubscribe token belongs to, with their language, or null. */
export async function findNewsletterToken(token: string): Promise<{ userId: string; optedIn: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const row = await queryOne<{ id: string; newsletter_opt_in: boolean }>(
    `SELECT id, newsletter_opt_in FROM users WHERE newsletter_token = $1`,
    [token]
  )
  return row ? { userId: row.id, optedIn: row.newsletter_opt_in === true } : null
}
