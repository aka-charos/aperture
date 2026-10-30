import type { SeerrUser } from './types.js'

/**
 * The name to show for a Seerr user. Pure, and the one copy: the Issues panel
 * and issue notifications both name comment authors with it.
 *
 * Seerr sets `displayName` on load (username || plexUsername ||
 * jellyfinUsername || email). The fallback chain is repeated rather than
 * trusted, because an Emby-imported user has an EMPTY `username` and their
 * name in `jellyfinUsername` — so picking the wrong field shows a blank
 * author, or an email address, next to every comment.
 */
export function seerrDisplayName(user: SeerrUser | undefined): string | null {
  if (!user) return null
  const candidates = [user.displayName, user.username, user.jellyfinUsername, user.email]
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim()
    if (trimmed) return trimmed
  }
  return null
}
