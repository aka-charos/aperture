/**
 * Match an Aperture user to a Seerr user (GET /user).
 *
 * This decides who a request or an issue is filed as, which is the whole
 * point of sending `X-API-User`. Getting it wrong is worse than not matching
 * at all: an unmatched user falls back to the API key's own identity, which
 * is merely the old behaviour, while a wrong match puts one person's name on
 * another person's request and — once issues land — on their replies.
 *
 * What Seerr actually stores, which is what this has to match against:
 * `POST /user/import-from-jellyfin` writes `jellyfinUsername` and
 * `jellyfinUserId` for BOTH Jellyfin and Emby (there are no Emby columns;
 * only `userType` distinguishes them), leaves `username` unset, and fills
 * `email` with the person's *username* rather than an email address.
 */
import type { SeerrUser } from './types.js'

export interface ApertureUserProfileForSeerr {
  email: string | null | undefined
  username: string
  displayName: string | null | undefined
  provider: 'emby' | 'jellyfin'
  providerUserId: string
}

/** Which signal decided a match — carried for logging, not for behaviour. */
export type SeerrMatchTier = 'mediaServerId' | 'email' | 'username' | 'displayName'

export interface SeerrUserMatchResult {
  userId: number | null
  matchedBy: SeerrMatchTier | null
  /** A tier matched several Seerr users, so no identity could be trusted. */
  ambiguous: boolean
}

/**
 * Seerr's own id rule, copied deliberately rather than approximated.
 *
 * `normalizeJellyfinGuid` strips dashes, lowercases, and requires 32 hex
 * digits — and Seerr *queries* with the normalized form while *storing* the
 * raw value the media server handed it, so both sides of a comparison have to
 * go through this or a dashed-versus-undashed pair misses silently.
 *
 * Anything that is not a media-server GUID returns null, which skips the tier
 * rather than comparing two strings that were never identifiers.
 */
export function normalizeMediaServerId(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : null
}

/** An email tier is only meaningful between two things that are actually emails. */
function asEmail(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : null
}

function asName(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim().toLowerCase()
  return trimmed ? trimmed : null
}

/**
 * Resolve which Seerr user an Aperture profile is, with the reason.
 *
 * Tiers are tried strongest first and the first one to produce EXACTLY ONE
 * candidate wins. Two rules make that safe:
 *
 * - A tier matching several users **stops the search** rather than falling
 *   through. A weaker signal breaking a tie the stronger one could not is not
 *   evidence, it is noise, and the resulting id is cached forever.
 * - The id tier leads. It is the only field here that is an identifier; the
 *   others are names people change. The previous order tried email first and
 *   guarded the id path with `provider === 'jellyfin'`, so on an Emby
 *   instance the one stable GUID both systems already hold was never read and
 *   matching came down to comparing usernames.
 */
export function resolveSeerrUserMatch(
  profile: ApertureUserProfileForSeerr,
  seerrUsers: SeerrUser[]
): SeerrUserMatchResult {
  const mediaServerId = normalizeMediaServerId(profile.providerUserId)
  const email = asEmail(profile.email)
  const username = asName(profile.username)
  const displayName = asName(profile.displayName)

  const tiers: { tier: SeerrMatchTier; matches: SeerrUser[] }[] = [
    {
      tier: 'mediaServerId',
      // No provider guard: Seerr files Emby users in this same column.
      matches: mediaServerId
        ? seerrUsers.filter((u) => normalizeMediaServerId(u.jellyfinUserId) === mediaServerId)
        : [],
    },
    {
      tier: 'email',
      // Both sides must look like an email. Seerr fills the column with the
      // username for imported users, and matching an address against a bare
      // username is a coincidence, not an identity.
      matches: email ? seerrUsers.filter((u) => asEmail(u.email) === email) : [],
    },
    {
      tier: 'username',
      matches: username
        ? seerrUsers.filter(
            (u) => asName(u.username) === username || asName(u.jellyfinUsername) === username
          )
        : [],
    },
    {
      tier: 'displayName',
      matches: displayName
        ? seerrUsers.filter(
            (u) => asName(u.username) === displayName || asName(u.jellyfinUsername) === displayName
          )
        : [],
    },
  ]

  for (const { tier, matches } of tiers) {
    if (matches.length === 1) {
      return { userId: matches[0].id, matchedBy: tier, ambiguous: false }
    }
    if (matches.length > 1) {
      return { userId: null, matchedBy: tier, ambiguous: true }
    }
  }

  return { userId: null, matchedBy: null, ambiguous: false }
}

/**
 * Pick the Seerr user id for an Aperture profile, or null.
 *
 * Thin reader over `resolveSeerrUserMatch` for callers that only need the id.
 */
export function matchApertureProfileToSeerrUser(
  profile: ApertureUserProfileForSeerr,
  seerrUsers: SeerrUser[]
): number | null {
  return resolveSeerrUserMatch(profile, seerrUsers).userId
}
