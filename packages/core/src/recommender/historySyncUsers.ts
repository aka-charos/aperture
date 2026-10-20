/**
 * Which accounts a watch-history sync should ask the media server about.
 * Pure, no database.
 *
 * Both history syncs used to ask about every Aperture account that is linked
 * to a media-server id and not yet marked gone (`provider_disabled`). Marking
 * is the user sync's job, and it only runs on its own schedule — weekly on
 * some instances — so an account deleted on the media server stayed unmarked
 * for days, and every history sync in between asked the server for the
 * history of a user it no longer had. Emby answers that with a 500, which
 * reads in the job log as a server fault rather than a deleted account.
 *
 * Each history sync already fetches the server's full user list. This uses it
 * to SKIP accounts the list does not contain. It deliberately does not mark
 * them: marking shuts an account out (sessions, API keys, background work)
 * and is audited, so it stays with the user sync, which is the one writer.
 * Skipping is cheap to get wrong in either direction (a wrongly skipped
 * account just syncs next time), but the same trust rule applies anyway, by
 * using the user sync's own `accountsGoneFromMediaServer`: an empty listing,
 * or one sharing no account with Aperture, is not believed, and then nobody
 * is skipped. Gone is decided against the accounts that existed BEFORE the
 * sync imported new ones, for the reason given in users/sync.ts.
 */

import { accountsGoneFromMediaServer, type GoneRefusal } from '../users/providerPresence.js'

export interface HistorySyncAccount {
  id: string
  provider_user_id: string | null
}

export interface HistorySyncPartition<T> {
  sync: T[]
  /** On the media server's list no longer; the user sync will mark them. */
  skipped: T[]
  /** Set when the listing was not trusted, in which case nobody is skipped. */
  refusal: GoneRefusal | null
}

export function partitionHistorySyncUsers<T extends HistorySyncAccount>(
  eligible: readonly T[],
  accountsBeforeImport: readonly HistorySyncAccount[],
  listedProviderIds: Iterable<string>
): HistorySyncPartition<T> {
  const decision = accountsGoneFromMediaServer(
    accountsBeforeImport.map((a) => ({ id: a.id, providerUserId: a.provider_user_id })),
    listedProviderIds
  )
  if (!decision.ok) return { sync: [...eligible], skipped: [], refusal: decision.reason }

  const goneIds = new Set(decision.gone.map((a) => a.id))
  return {
    sync: eligible.filter((u) => !goneIds.has(u.id)),
    skipped: eligible.filter((u) => goneIds.has(u.id)),
    refusal: null,
  }
}
