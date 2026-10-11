/**
 * Account drift: where the media server, LLDAP and Aperture disagree about
 * who has an account. Pure, no database; `accountDriftReport.ts` reads the
 * three lists and hands them here.
 *
 * Accounts reach Aperture from the media server, matched by the server's
 * account id, and each one's email address from the LLDAP account with the
 * same username (`directoryUsernameKey`, ignoring case). Nothing removes an
 * Aperture account when its media-server account is deleted, and nothing ties
 * an LLDAP account to either, so the three drift apart quietly: someone
 * removed from the media server keeps an Aperture account with an address on
 * file, and keeps an LLDAP account that may still let them sign in again.
 * The Users page cannot show either, because it is drawn from the media
 * server's own list.
 *
 * LLDAP is optional: when it is not set up or could not be read it is passed
 * as null and every finding that needs it is left out rather than guessed,
 * since "no LLDAP account" from a server that did not answer would name every
 * person on the instance. The media server is not optional — Aperture's own
 * accounts are copies of it, so without its list there is nothing to compare
 * against, and the report says so instead of calling this.
 */
import { directoryUsernameKey, lldapEmailState } from '../lldap/rules.js'

export interface DriftMediaServerAccount {
  id: string
  name: string
  disabled: boolean
  admin: boolean
  lastActivity: string | null
}

export interface DriftLldapAccount {
  id: string
  displayName: string | null
  /** As LLDAP holds it, unvalidated. */
  email: string | null
  created: string | null
  groups: string[]
}

export interface DriftApertureAccount {
  id: string
  username: string
  providerUserId: string | null
  email: string | null
  emailLocked: boolean
  accessEnabled: boolean
}

export const DRIFT_FINDINGS = [
  // An account in one place and not another.
  'lldapOnly',
  'lldapServiceAccount',
  'goneFromMediaServer',
  'replacedOnMediaServer',
  'stillInLldap',
  'noLldapAccount',
  // Out of step.
  'renamedOnMediaServer',
  'notImported',
  'disabledOnMediaServer',
  // The address the email import takes from LLDAP.
  'lldapEmailUnusable',
  'lldapNoEmail',
  'emailPending',
  'emailOverridden',
] as const
export type DriftFindingId = (typeof DRIFT_FINDINGS)[number]

export type DriftSeverity = 'warning' | 'info'

/**
 * A warning is an account that exists where it should not, or is missing
 * where it should be, or a fault that stops an address being imported. The
 * rest is the normal course of things (an import not run yet, an address
 * someone chose to keep) and is shown so it is not mistaken for drift.
 */
export const DRIFT_FINDING_SEVERITY: Record<DriftFindingId, DriftSeverity> = {
  lldapOnly: 'warning',
  lldapServiceAccount: 'info',
  goneFromMediaServer: 'warning',
  replacedOnMediaServer: 'warning',
  stillInLldap: 'warning',
  noLldapAccount: 'warning',
  renamedOnMediaServer: 'warning',
  notImported: 'info',
  disabledOnMediaServer: 'info',
  lldapEmailUnusable: 'warning',
  lldapNoEmail: 'info',
  emailPending: 'info',
  emailOverridden: 'info',
}

export interface DriftFinding {
  id: DriftFindingId
  severity: DriftSeverity
  /** Names and addresses the sentence for this finding mentions. */
  vars?: Record<string, string>
}

export type DriftRowStatus = 'warning' | 'info' | 'inSync'

export interface DriftRow {
  key: string
  name: string
  mediaServer: DriftMediaServerAccount | null
  lldap: DriftLldapAccount | null
  aperture: DriftApertureAccount | null
  findings: DriftFinding[]
  status: DriftRowStatus
}

export interface DriftSummary {
  total: number
  warning: number
  info: number
  inSync: number
  findings: Record<DriftFindingId, number>
}

export interface DriftInput {
  mediaServer: readonly DriftMediaServerAccount[]
  /** Null when LLDAP is not set up or could not be read. */
  lldap: readonly DriftLldapAccount[] | null
  /**
   * The LLDAP account Aperture itself signs in with. It is a service account,
   * not a person, so it has no media-server account by design and is named
   * as what it is rather than reported as drift on every check.
   */
  lldapServiceAccount?: string | null
  aperture: readonly DriftApertureAccount[]
}

const STATUS_RANK: Record<DriftRowStatus, number> = { warning: 0, info: 1, inSync: 2 }

export function buildAccountDrift(input: DriftInput): { rows: DriftRow[]; summary: DriftSummary } {
  const ldListed = input.lldap !== null
  const serviceKey = input.lldapServiceAccount ? directoryUsernameKey(input.lldapServiceAccount) : null

  const lldapByKey = new Map<string, DriftLldapAccount>()
  for (const ld of input.lldap ?? []) lldapByKey.set(directoryUsernameKey(ld.id), ld)
  const apertureByProviderId = new Map<string, DriftApertureAccount>()
  for (const ap of input.aperture) {
    if (ap.providerUserId) apertureByProviderId.set(ap.providerUserId, ap)
  }
  const mediaServerNames = new Set(input.mediaServer.map((ms) => directoryUsernameKey(ms.name)))

  const claimedLldap = new Set<string>()
  const usedAperture = new Set<string>()
  const rows: DriftRow[] = []

  const attach = (ld: DriftLldapAccount | undefined): DriftLldapAccount | null => {
    if (!ld) return null
    claimedLldap.add(ld.id)
    return ld
  }

  for (const ms of input.mediaServer) {
    const ap = apertureByProviderId.get(ms.id) ?? null
    if (ap) usedAperture.add(ap.id)
    // The person in LLDAP: under the server's current name, or under the name
    // Aperture still holds when the account was renamed.
    const ld = attach(
      lldapByKey.get(directoryUsernameKey(ms.name)) ??
        (ap ? lldapByKey.get(directoryUsernameKey(ap.username)) : undefined)
    )
    rows.push(finish({ key: `ms:${ms.id}`, name: ms.name, mediaServer: ms, lldap: ld, aperture: ap }))
  }

  for (const ap of input.aperture) {
    if (usedAperture.has(ap.id)) continue
    const ld = attach(lldapByKey.get(directoryUsernameKey(ap.username)))
    rows.push(finish({ key: `ap:${ap.id}`, name: ap.username, mediaServer: null, lldap: ld, aperture: ap }))
  }

  for (const ld of input.lldap ?? []) {
    if (claimedLldap.has(ld.id)) continue
    rows.push(finish({ key: `ld:${ld.id}`, name: ld.id, mediaServer: null, lldap: ld, aperture: null }))
  }

  function finish(row: Omit<DriftRow, 'findings' | 'status'>): DriftRow {
    const findings = findingsFor(row)
    const status: DriftRowStatus = findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : findings.length > 0
        ? 'info'
        : 'inSync'
    return { ...row, findings, status }
  }

  function findingsFor(row: Omit<DriftRow, 'findings' | 'status'>): DriftFinding[] {
    const { mediaServer: ms, lldap: ld, aperture: ap } = row
    const out: DriftFinding[] = []
    const add = (id: DriftFindingId, vars?: Record<string, string>) =>
      out.push(vars ? { id, severity: DRIFT_FINDING_SEVERITY[id], vars } : { id, severity: DRIFT_FINDING_SEVERITY[id] })

    if (!ms) {
      if (ap) {
        if (mediaServerNames.has(directoryUsernameKey(ap.username))) {
          add('replacedOnMediaServer')
        } else {
          add('goneFromMediaServer', ap.email ? { email: ap.email } : undefined)
          if (ld) add('stillInLldap')
        }
      } else if (ld) {
        add(directoryUsernameKey(ld.id) === serviceKey ? 'lldapServiceAccount' : 'lldapOnly')
      }
      return sortFindings(out)
    }

    if (ap && directoryUsernameKey(ms.name) !== directoryUsernameKey(ap.username)) {
      add('renamedOnMediaServer', { name: ms.name, oldName: ap.username })
    }
    if (!ap) add('notImported')
    if (ms.disabled && ld) add('disabledOnMediaServer')
    if (ldListed && !ld) add('noLldapAccount', { name: ms.name })

    // The import reads the LLDAP account under the username Aperture holds,
    // which is not the one attached above when the account was renamed.
    const imported = ap ? lldapByKey.get(directoryUsernameKey(ap.username)) : undefined
    if (ap && imported) {
      const email = lldapEmailState(imported.email)
      if (email.state === 'none') add('lldapNoEmail')
      else if (email.state === 'unusable') add('lldapEmailUnusable', { email: email.raw })
      else if (ap.email !== email.email) add(ap.emailLocked ? 'emailOverridden' : 'emailPending', { email: email.email })
    }
    return sortFindings(out)
  }

  rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key)
  )

  const findings = Object.fromEntries(DRIFT_FINDINGS.map((id) => [id, 0])) as Record<DriftFindingId, number>
  for (const row of rows) for (const f of row.findings) findings[f.id]++

  return {
    rows,
    summary: {
      total: rows.length,
      warning: rows.filter((r) => r.status === 'warning').length,
      info: rows.filter((r) => r.status === 'info').length,
      inSync: rows.filter((r) => r.status === 'inSync').length,
      findings,
    },
  }
}

function sortFindings(findings: DriftFinding[]): DriftFinding[] {
  return findings.sort((a, b) => STATUS_RANK[a.severity] - STATUS_RANK[b.severity])
}
