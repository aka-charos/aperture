/**
 * The newsletter routes, as the console calls them. Types mirror the API by
 * hand (the bundle never imports core).
 */

export type NewsletterStatus = 'draft' | 'sending' | 'sent' | 'failed'

export interface Newsletter {
  id: string
  subject: string
  preheader: string
  content: Record<string, unknown>
  groupIds: string[]
  status: NewsletterStatus
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

export interface GroupRules {
  match: 'rules' | 'none'
  languages: string[]
  role: 'any' | 'admins' | 'viewers'
}

export interface NewsletterGroup {
  id: string
  name: string
  description: string
  rules: GroupRules
  memberCount?: number
  recipientCount?: number
}

export interface NewsletterOptions {
  languages: { code: string; label: string }[]
  defaultLanguage: string
  titleFields: string[]
  defaultTitleFields: string[]
  /** Decided by the server: the analysis parts a card may choose, per media type. */
  analysisParts: { movie: string[]; series: string[] }
  sendingProblem: string | null
  sendingProblemText: string | null
}

export interface AudienceSummary {
  recipients: { id: string; username: string; displayName: string | null; email: string | null; language: string }[]
  byLanguage: Record<string, number>
}

export interface GroupMemberRow {
  id: string
  username: string
  displayName: string | null
  email: string | null
  isAdmin: boolean
  language: string
  mode: 'include' | 'exclude' | null
  member: boolean
  reason: 'rules' | 'included' | 'excluded' | 'none'
  ineligible: 'notOptedIn' | 'noAddress' | 'noAccess' | null
}

export interface Delivery {
  userId: string | null
  username: string | null
  email: string
  language: string
  status: 'sent' | 'failed'
  error: string | null
  sentAt: string
}

export interface DraftPayload {
  subject: string
  preheader: string
  content: Record<string, unknown>
  groupIds: string[]
}

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const response = await fetch(path, {
    credentials: 'include',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status})`)
  return data
}

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
