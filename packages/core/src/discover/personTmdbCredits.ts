/**
 * What TMDb says a person did, title by title, and whether TMDb's person is
 * the one the library credits. Pure; pinned by `personTmdbCredits.test.ts`.
 *
 * The person page finds a person's library titles by name in the cast and
 * crew the media server recorded. That misses titles the media server
 * credits them on under another spelling, or not at all (a cast list cut
 * short at an older sync). TMDb's combined credits fill those in, by TMDb id.
 *
 * TMDb's person is found by NAME SEARCH, which can land on a namesake (an
 * inexact search answer is the most popular result), so TMDb's credits and
 * biography are trusted only when they agree with the library on at least
 * one title the media server already credits the person on by name. The
 * failure is the safe side: no agreement, nothing added.
 */

import type { TmdbCombinedCreditsResponse } from '../tmdb/person.js'
import {
  creditsRoleKindFromEntry,
  flattenCombinedCreditsWithRoles,
  type CreditsRoleKind,
} from './personCreditsGap.js'

export type TmdbCreditMedia = 'movie' | 'tv'

export interface TmdbTitleCredit {
  media: TmdbCreditMedia
  tmdbId: string
  /** Every role TMDb lists for this person on the title, in TMDb's order. */
  roles: CreditsRoleKind[]
  /** The character played, when TMDb lists one; the first cast credit's. */
  character: string | null
}

export function tmdbTitleKey(media: TmdbCreditMedia, tmdbId: string | number): string {
  return `${media}:${String(tmdbId).trim()}`
}

/** One entry per title (media + TMDb id), roles merged. Adult titles are left out. */
export function tmdbCreditsByTitle(
  credits: TmdbCombinedCreditsResponse
): Map<string, TmdbTitleCredit> {
  const byTitle = new Map<string, TmdbTitleCredit>()
  for (const { entry, fromCast } of flattenCombinedCreditsWithRoles(credits)) {
    const media: TmdbCreditMedia = entry.media_type === 'tv' ? 'tv' : 'movie'
    const key = tmdbTitleKey(media, entry.id)
    let credit = byTitle.get(key)
    if (!credit) {
      credit = { media, tmdbId: String(entry.id), roles: [], character: null }
      byTitle.set(key, credit)
    }
    const role = creditsRoleKindFromEntry(entry, fromCast)
    if (!credit.roles.includes(role)) credit.roles.push(role)
    const character = fromCast ? entry.character?.trim() : undefined
    if (character && credit.character == null) credit.character = character
  }
  return byTitle
}

export interface LibraryTitleRef {
  media: TmdbCreditMedia
  tmdbId: string | null
}

/**
 * True when TMDb's person is credited on at least one title the media server
 * already credits by name; that agreement is what makes TMDb's person this one.
 */
export function tmdbPersonAgreesWithLibrary(
  byTitle: ReadonlyMap<string, TmdbTitleCredit>,
  nameMatched: readonly LibraryTitleRef[]
): boolean {
  return nameMatched.some(
    (title) => title.tmdbId != null && title.tmdbId.trim() !== '' && byTitle.has(tmdbTitleKey(title.media, title.tmdbId))
  )
}
