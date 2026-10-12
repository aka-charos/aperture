/**
 * Reads the three account lists the drift report compares — the media
 * server's, LLDAP's and Aperture's own — and hands them to `buildAccountDrift`.
 *
 * Read live on every call, never cached: the report exists to be checked
 * after changing something in one of the directories, and a cached answer
 * would show the drift that was just fixed. All three are read at once; each
 * is one request (the LLDAP side is a login and one query), so the report
 * answers in about the time of the slowest.
 *
 * Never throws for a source: a directory that cannot be read is reported as
 * such, with its own error text, beside whatever could be read. Each source
 * also has its own deadline, because this answers an HTTP request and the
 * media-server client allows a single call a full minute — longer than a
 * proxy in front of the app waits before cutting the request (F-141).
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getMediaServerProvider } from '../media/index.js'
import { authenticateLldap, fetchLldapDirectory } from '../lldap/client.js'
import {
  getLldapAdminPassword,
  getLldapConfig,
  getMediaServerConfig,
  type MediaServerConfig,
} from '../settings/systemSettings.js'
import {
  buildAccountDrift,
  type DriftApertureAccount,
  type DriftLldapAccount,
  type DriftMediaServerAccount,
  type DriftRow,
  type DriftSummary,
} from './accountDrift.js'

const logger = createChildLogger('account-drift')

/** How long one directory may take before it is reported as not answering. */
export const DRIFT_SOURCE_DEADLINE_MS = 25_000

export type DriftSource = { state: 'ok'; count: number } | { state: 'notConfigured' } | { state: 'failed'; error: string }

export interface AccountDriftReport {
  generatedAt: string
  /** Which media server the accounts come from, or null when none is set up. */
  mediaServerType: 'emby' | 'jellyfin' | null
  sources: { mediaServer: DriftSource; lldap: DriftSource; aperture: { state: 'ok'; count: number } }
  /** Empty, with a null summary, when the media server could not be read: there is nothing to compare against. */
  rows: DriftRow[]
  summary: DriftSummary | null
}

type Read<T> = { source: DriftSource; accounts: T[] | null }

function failed<T>(err: unknown): Read<T> {
  return { source: { state: 'failed', error: err instanceof Error ? err.message : String(err) }, accounts: null }
}

/** The read, or a failure once the deadline passes. The request itself is left to its own timeout. */
async function withDeadline<T>(read: Promise<Read<T>>, what: string): Promise<Read<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<Read<T>>((resolve) => {
    timer = setTimeout(
      () => resolve(failed(`${what} did not answer within ${DRIFT_SOURCE_DEADLINE_MS / 1000} seconds`)),
      DRIFT_SOURCE_DEADLINE_MS
    )
  })
  try {
    return await Promise.race([read, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function readMediaServer(config: MediaServerConfig): Promise<Read<DriftMediaServerAccount>> {
  if (!config.type || !config.baseUrl || !config.apiKey) {
    return { source: { state: 'notConfigured' }, accounts: null }
  }
  try {
    const provider = await getMediaServerProvider()
    const users = await provider.getUsers(config.apiKey)
    return {
      source: { state: 'ok', count: users.length },
      accounts: users.map((u) => ({
        id: u.id,
        name: u.name,
        disabled: !!u.isDisabled,
        admin: !!u.isAdmin,
        lastActivity: u.lastActivityDate ?? null,
      })),
    }
  } catch (err) {
    logger.warn({ err }, 'Account drift: media server accounts not read')
    return failed(err)
  }
}

async function readLldap(): Promise<Read<DriftLldapAccount>> {
  const config = await getLldapConfig()
  const password = await getLldapAdminPassword()
  if (!config.enabled || !config.url || !config.adminUsername || !password) {
    return { source: { state: 'notConfigured' }, accounts: null }
  }
  try {
    const auth = await authenticateLldap(config.url, config.adminUsername, password)
    if (!auth.ok) return failed(auth.error)
    const directory = await fetchLldapDirectory(config.url, auth.value.token)
    if (!directory.ok) return failed(directory.error)
    const users = directory.value.users
    return {
      source: { state: 'ok', count: users.length },
      accounts: users.map((u) => ({
        id: u.id,
        displayName: u.displayName || null,
        email: u.email || null,
        created: u.creationDate || null,
        groups: (u.groups ?? []).map((g) => g.displayName).filter(Boolean),
      })),
    }
  } catch (err) {
    logger.warn({ err }, 'Account drift: LLDAP accounts not read')
    return failed(err)
  }
}

async function readAperture(): Promise<DriftApertureAccount[]> {
  const result = await query<{
    id: string
    username: string
    provider_user_id: string | null
    email: string | null
    email_locked: boolean | null
    is_enabled: boolean | null
    provider_missing_at: Date | null
  }>('SELECT id, username, provider_user_id, email, email_locked, is_enabled, provider_missing_at FROM users')
  return result.rows.map((r) => ({
    id: r.id,
    username: r.username,
    providerUserId: r.provider_user_id,
    email: r.email,
    emailLocked: r.email_locked === true,
    accessEnabled: r.is_enabled === true,
    pausedSince: r.provider_missing_at ? r.provider_missing_at.toISOString() : null,
  }))
}

export async function loadAccountDriftReport(): Promise<AccountDriftReport> {
  const [msConfig, lldapConfig] = await Promise.all([getMediaServerConfig(), getLldapConfig()])
  const [mediaServer, lldap, aperture] = await Promise.all([
    withDeadline(readMediaServer(msConfig), 'The media server'),
    withDeadline(readLldap(), 'LLDAP'),
    readAperture(),
  ])
  const built = mediaServer.accounts
    ? buildAccountDrift({
        mediaServer: mediaServer.accounts,
        lldap: lldap.accounts,
        aperture,
        lldapServiceAccount: lldapConfig.adminUsername,
      })
    : null
  return {
    generatedAt: new Date().toISOString(),
    mediaServerType: msConfig.type,
    sources: {
      mediaServer: mediaServer.source,
      lldap: lldap.source,
      aperture: { state: 'ok', count: aperture.length },
    },
    rows: built?.rows ?? [],
    summary: built?.summary ?? null,
  }
}
