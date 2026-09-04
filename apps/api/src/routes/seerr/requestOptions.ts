/**
 * What a request body is allowed to say, decided rather than trusted.
 *
 * Two separate concerns, both pure so they can be pinned:
 *
 * Radarr/Sonarr overrides name real directories on the server. Sending them
 * to the browser so a viewer can choose one leaks the filesystem layout to
 * everyone who can reach the page, and lets them file into a library the
 * operator never meant them to touch. The dialog is admin-only now, but a
 * dialog is UI: the body still arrives from a client, so the decision has to
 * live here too or it is a suggestion.
 *
 * `is4k` deliberately survives. It is not a path, and Seerr enforces
 * REQUEST_4K against the acting user itself, so passing it through asks Seerr
 * a question it is already equipped to refuse.
 */

export interface RequestOverrides {
  rootFolder?: string
  profileId?: number
  serverId?: number
  languageProfileId?: number
  is4k?: boolean
}

/** Overrides this caller is permitted to set. */
export function pickRequestOverrides(input: RequestOverrides, isAdmin: boolean): RequestOverrides {
  const allowed: RequestOverrides = {}

  if (input.is4k !== undefined) allowed.is4k = input.is4k
  if (!isAdmin) return allowed

  if (input.rootFolder !== undefined) allowed.rootFolder = input.rootFolder
  if (input.profileId !== undefined) allowed.profileId = input.profileId
  if (input.serverId !== undefined) allowed.serverId = input.serverId
  if (input.languageProfileId !== undefined) allowed.languageProfileId = input.languageProfileId

  return allowed
}

/**
 * Where this request says it came from.
 *
 * `gap_analysis` is deliberately unreachable: those rows are written by the
 * gap-analysis job through core, and letting a browser claim that origin
 * would corrupt the one column that separates what the recommender proposed
 * from what someone went looking for. Anything unrecognised reads as
 * `discovery`, which is the pre-existing default and the safe direction.
 */
export function resolveRequestSource(raw: string | undefined): 'discovery' | 'direct' {
  return raw === 'direct' ? 'direct' : 'discovery'
}
