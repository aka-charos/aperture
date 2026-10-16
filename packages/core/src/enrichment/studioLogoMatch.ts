/**
 * Studio/network logo lookup rules: how a library name is matched to a TMDb
 * company or network, and how each lookup is classified for the job's report.
 *
 * Pure, no DB, pinned by studioLogoMatch.test.ts.
 */

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
