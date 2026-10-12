/**
 * Which Aperture accounts the media server no longer has. Pure, no database.
 *
 * An account is on the media server when its `provider_user_id` is in the
 * server's full user list. The user sync, the Users page and the account
 * removal route all ask this one question and act on the answer, so it lives
 * once, here.
 *
 * The answer is ACTED on — the sync shuts a gone account out (sessions, API
 * keys, background work) and the removal route deletes it — so a wrong "gone"
 * is the expensive mistake and a missed one is cheap: the next run catches it.
 * Two listings are therefore refused outright rather than believed:
 *
 * - **An empty list.** A media server with no accounts at all is not a thing
 *   anyone runs; a misread or a misconfigured key is.
 * - **A list sharing no account with Aperture.** Media-server ids are GUIDs,
 *   so a server holding none of the accounts Aperture knows is a different
 *   server (a changed address, a test instance), not a server everyone left.
 *   Believing it would shut every account out at once.
 */

export interface LinkedAccount {
  providerUserId: string | null
}

export type GoneRefusal = 'emptyListing' | 'noOverlap'

export type GoneDecision<T> = { ok: true; gone: T[] } | { ok: false; reason: GoneRefusal }

export function accountsGoneFromMediaServer<T extends LinkedAccount>(
  accounts: readonly T[],
  listedIds: Iterable<string>
): GoneDecision<T> {
  const listed = new Set(listedIds)
  if (listed.size === 0) return { ok: false, reason: 'emptyListing' }

  const linked = accounts.filter((a) => a.providerUserId !== null)
  const present = linked.filter((a) => listed.has(a.providerUserId as string))
  if (linked.length > 0 && present.length === 0) return { ok: false, reason: 'noOverlap' }

  // An account never linked to a media-server id cannot be on the server.
  return { ok: true, gone: accounts.filter((a) => a.providerUserId === null || !listed.has(a.providerUserId)) }
}
