/**
 * Studio/network logo lookup rules: how a library name is matched to a TMDb
 * company or network, and how each lookup is classified for the job's report.
 *
 * Pure, no DB, pinned by studioLogoMatch.test.ts.
 */

import { TMDB_IMAGE_BASE_URL } from '../tmdb/types.js'

/** What TMDb knows about one company or network. */
export interface TmdbLogoEntity {
  id: number
  name: string
  logo_path: string | null
  origin_country: string | null
}

/**
 * How one studio/network lookup ended. These are the four answers the report
 * separates, because they have different fixes:
 * - `logo`     TMDb has the entity and a logo; it is stored.
 * - `noLogo`   TMDb has the entity, with no logo — nothing to fetch, ever.
 * - `notFound` no TMDb entity carries this exact name.
 * - `error`    a TMDb request or the image download failed; retry later.
 */
export type LogoOutcome = 'logo' | 'noLogo' | 'notFound' | 'error'

/** Where a match came from. */
export type LogoMatchSource = 'title' | 'search'

/** How long a row TMDb had no logo for waits before it is asked again. */
export const LOGO_RECHECK_DAYS = 30

/**
 * The rows a run looks up, shared by the job's count and its selection so the
 * progress bar describes the set the loop actually walks.
 *
 * Never checked (NULL) is due whether or not a logo is stored: logos from
 * before `logo_checked_at` existed may be another company's (first search
 * result) or another network's (a company id looked up as a network). A row
 * with a logo is not asked again after that; a row without one is asked again
 * after LOGO_RECHECK_DAYS. A failed lookup stamps nothing, so it stays due.
 */
export const LOGO_CHECK_DUE_SQL = `(logo_checked_at IS NULL OR (logo_path IS NULL AND logo_checked_at < NOW() - INTERVAL '${LOGO_RECHECK_DAYS} days'))`

/**
 * The local logo file a check leaves behind, or null. Files are named after the
 * row id plus TMDb's extension, so a logo replaced by one with another
 * extension, or a logo the check found was not this row's, would otherwise stay
 * on disk.
 */
export function replacedLogoFile(
  previous: string | null | undefined,
  current: string | null
): string | null {
  return previous && previous !== current ? previous : null
}

/**
 * The address a page shows a stored logo at, or null when there is none.
 *
 * The local copy wins only when its file is actually on disk: the row records
 * where a file was written, not that it is still there (a container recreate
 * empties anything outside a mounted volume, and logos were once written
 * outside it), and a 404 renders as initials on every page that shows logos.
 * Without the file, TMDb's own copy of the same logo is served instead.
 */
export function studioLogoUrl(logo: {
  localPath: string | null
  localFileExists: boolean
  tmdbPath: string | null
}): string | null {
  if (logo.localPath && logo.localFileExists) return `/api/uploads/${logo.localPath}`
  if (logo.tmdbPath) return `${TMDB_IMAGE_BASE_URL}/w185${logo.tmdbPath}`
  return null
}

/**
 * Whether a stored logo has to be downloaded again: it has no local path, or
 * the file at that path is gone.
 */
export function logoFileIsMissing(localPath: string | null, fileExists: boolean): boolean {
  return localPath == null || !fileExists
}

/**
 * The stored logos the media server does not have yet: a confirmed logo, a
 * file to send, a media-server item to send it to, and no record of a push.
 */
export const LOGO_PUSH_PENDING_SQL = `(logo_path IS NOT NULL AND logo_local_path IS NOT NULL AND emby_id IS NOT NULL AND emby_synced_at IS NULL)`

/**
 * One logo row per name: the `prefer` kind's when that name has one, the
 * other kind's otherwise. A name is filed as a studio when films carry it and
 * as a network when shows do (the logo job reads `series.studios` as
 * networks), so a company named on both has two rows and possibly two logos.
 */
export function preferredLogoRows<T extends { name: string; type: string }>(
  rows: readonly T[],
  prefer: 'studio' | 'network'
): Map<string, T> {
  const chosen = new Map<string, T>()
  for (const row of rows) {
    const held = chosen.get(row.name)
    if (!held || (held.type !== prefer && row.type === prefer)) chosen.set(row.name, row)
  }
  return chosen
}

/** Names compare case-, accent- and spacing-insensitively. */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The entity whose name is this name, or null. Never "the first result":
 * a near miss (searching "HBO" and getting "HBO Films") stores somebody
 * else's logo, which is worse than storing none.
 */
export function findEntityByName<T extends { name: string }>(
  name: string,
  candidates: readonly T[] | null | undefined
): T | null {
  const key = normalizeEntityName(name)
  if (!key) return null
  return candidates?.find((c) => normalizeEntityName(c.name) === key) ?? null
}

/** Running tally of outcomes for one kind (studios or networks). */
export interface LogoTally {
  checked: number
  logo: number
  noLogo: number
  notFound: number
  error: number
  viaTitle: number
  viaSearch: number
  /** Rows whose stored logo the check replaced or removed. */
  replaced: number
}

export function emptyTally(): LogoTally {
  return {
    checked: 0,
    logo: 0,
    noLogo: 0,
    notFound: 0,
    error: 0,
    viaTitle: 0,
    viaSearch: 0,
    replaced: 0,
  }
}

export function addOutcome(
  tally: LogoTally,
  outcome: LogoOutcome,
  source: LogoMatchSource | null
): void {
  tally.checked++
  tally[outcome]++
  // Only a stored match counts toward "matched via": a match whose logo then
  // failed to download is an error, and counting its source would make the
  // two halves of the report disagree.
  if (outcome !== 'logo' && outcome !== 'noLogo') return
  if (source === 'title') tally.viaTitle++
  else if (source === 'search') tally.viaSearch++
}

/** One line a person can read: what was checked and how each ended. */
export function describeTally(label: string, t: LogoTally): string {
  const matched = t.logo + t.noLogo
  return (
    `${label}: ${t.checked} checked — ${t.logo} logo stored, ` +
    `${t.noLogo} on TMDb without a logo, ${t.notFound} not found on TMDb, ` +
    `${t.error} failed (will retry). ` +
    `${matched} matched: ${t.viaTitle} via a title's TMDb details, ${t.viaSearch} via company search.` +
    (t.replaced > 0 ? ` ${t.replaced} previously stored logos replaced or removed.` : '')
  )
}
