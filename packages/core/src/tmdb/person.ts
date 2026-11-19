/**
 * TMDb person search, profile images, combined credits, and DB-backed name cache.
 */

import { query, queryOne } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { getImageUrl, tmdbLookup, tmdbRequest, type ApiLogCallback } from './client.js'
import {
  readTmdbPersonDetails,
  type TmdbPersonDetails,
  type TmdbPersonResponse,
} from './personDetails.js'

const logger = createChildLogger('tmdb-person')

/** Combined credits JSON TTL (24h). */
export const COMBINED_CREDITS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** How long "TMDb knows nobody by this name" is believed before asking again (7 days). */
export const PERSON_NOT_FOUND_RECHECK_MS = 7 * 24 * 60 * 60 * 1000

/** A stored "nobody by this name" still within its recheck window. */
function notFoundStillTrusted(row: { not_found: boolean; updated_at: Date } | null): boolean {
  return (
    row?.not_found === true &&
    Date.now() - new Date(row.updated_at).getTime() < PERSON_NOT_FOUND_RECHECK_MS
  )
}

export function normalizePersonNameKey(decodedName: string): string {
  return decodedName.trim().toLowerCase()
}

export interface TmdbPersonSearchResult {
  id: number
  name: string
  profile_path: string | null
  popularity: number
}

interface PersonSearchResponse {
  results?: TmdbPersonSearchResult[]
}

/** Case-insensitive exact name match, else the most popular result; null when there are none. */
function choosePerson(name: string, results: TmdbPersonSearchResult[] | undefined): TmdbPersonSearchResult | null {
  if (!results?.length) {
    return null
  }
  const trimmed = name.trim().toLowerCase()
  const exactMatch = results.find((p) => p.name.toLowerCase() === trimmed)
  if (exactMatch) {
    return exactMatch
  }
  return [...results].sort((a, b) => b.popularity - a.popularity)[0]
}

/**
 * Search TMDb for a person by name; prefers case-insensitive exact name match, else highest popularity.
 * Null both when nobody matches and when TMDb could not be asked: anything that
 * keeps the answer uses {@link lookupPersonByName}.
 */
export async function searchPersonByName(
  name: string,
  options: { onLog?: ApiLogCallback } = {}
): Promise<TmdbPersonSearchResult | null> {
  const result = await tmdbRequest<PersonSearchResponse>(
    `/search/person?query=${encodeURIComponent(name)}`,
    options
  )
  return choosePerson(name, result?.results)
}

/**
 * Search TMDb for a person by name, telling "nobody by that name" (`ok` with
 * null) from a request that failed (`failed`).
 */
export async function lookupPersonByName(
  name: string
): Promise<{ status: 'ok'; person: TmdbPersonSearchResult | null } | { status: 'failed' }> {
  const answer = await tmdbLookup<PersonSearchResponse>(
    `/search/person?query=${encodeURIComponent(name)}`
  )
  if (answer.status === 'failed') {
    return { status: 'failed' }
  }
  return { status: 'ok', person: answer.status === 'ok' ? choosePerson(name, answer.data.results) : null }
}

/** Raw combined credits from TMDb (movie + TV cast and crew). */
export interface TmdbCombinedCreditsResponse {
  id?: number
  cast?: TmdbCombinedCreditEntry[]
  crew?: TmdbCombinedCreditEntry[]
}

export interface TmdbCombinedCreditEntry {
  id: number
  media_type?: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  poster_path?: string | null
  backdrop_path?: string | null
  character?: string
  job?: string
  department?: string
  release_date?: string | null
  first_air_date?: string | null
  adult?: boolean
}

export async function getPersonCombinedCredits(
  personId: number,
  options: { onLog?: ApiLogCallback } = {}
): Promise<TmdbCombinedCreditsResponse | null> {
  return tmdbRequest<TmdbCombinedCreditsResponse>(
    `/person/${personId}/combined_credits`,
    options
  )
}

interface ProfileCacheRow {
  name_key: string
  tmdb_person_id: number | null
  profile_path: string | null
  not_found: boolean
  combined_credits_json: unknown
  combined_credits_cached_at: Date | null
  updated_at: Date
}

export async function getPersonTmdbCacheRow(
  nameKey: string
): Promise<ProfileCacheRow | null> {
  return queryOne<ProfileCacheRow>(
    `SELECT name_key, tmdb_person_id, profile_path, not_found,
            combined_credits_json, combined_credits_cached_at, updated_at
     FROM person_tmdb_profile_cache WHERE name_key = $1`,
    [nameKey]
  )
}

export async function upsertPersonTmdbCache(params: {
  nameKey: string
  tmdbPersonId: number | null
  profilePath: string | null
  notFound: boolean
}): Promise<void> {
  await query(
    `INSERT INTO person_tmdb_profile_cache (
       name_key, tmdb_person_id, profile_path, not_found, updated_at
     ) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (name_key) DO UPDATE SET
       tmdb_person_id = EXCLUDED.tmdb_person_id,
       profile_path = EXCLUDED.profile_path,
       not_found = EXCLUDED.not_found,
       updated_at = NOW()`,
    [params.nameKey, params.tmdbPersonId, params.profilePath, params.notFound]
  )
}

export async function upsertPersonCombinedCreditsCache(
  nameKey: string,
  tmdbPersonId: number,
  json: TmdbCombinedCreditsResponse
): Promise<void> {
  await query(
    `INSERT INTO person_tmdb_profile_cache (
       name_key, tmdb_person_id, not_found,
       combined_credits_json, combined_credits_cached_at, updated_at
     ) VALUES ($1, $2, FALSE, $3::jsonb, NOW(), NOW())
     ON CONFLICT (name_key) DO UPDATE SET
       tmdb_person_id = COALESCE(person_tmdb_profile_cache.tmdb_person_id, EXCLUDED.tmdb_person_id),
       combined_credits_json = EXCLUDED.combined_credits_json,
       combined_credits_cached_at = EXCLUDED.combined_credits_cached_at,
       updated_at = NOW()`,
    [nameKey, tmdbPersonId, JSON.stringify(json)]
  )
}

export interface ResolveTmdbPersonProfileResult {
  imageUrl: string | null
  tmdbPersonId: number | null
}

/**
 * Resolve profile image URL from cache or TMDb search; upserts cache row.
 */
export async function resolveTmdbPersonProfileImageUrl(
  decodedName: string
): Promise<ResolveTmdbPersonProfileResult> {
  const nameKey = normalizePersonNameKey(decodedName)
  const cached = await getPersonTmdbCacheRow(nameKey)

  if (notFoundStillTrusted(cached)) {
    return { imageUrl: null, tmdbPersonId: null }
  }

  if (cached?.tmdb_person_id != null && !cached.not_found) {
    const url = getImageUrl(cached.profile_path, 'w185')
    return { imageUrl: url, tmdbPersonId: cached.tmdb_person_id }
  }

  // A failed request is not "nobody by that name": nothing is stored, and the
  // next visit asks again.
  const lookup = await lookupPersonByName(decodedName)
  if (lookup.status === 'failed') {
    return { imageUrl: null, tmdbPersonId: null }
  }
  const found = lookup.person
  if (!found) {
    await upsertPersonTmdbCache({
      nameKey,
      tmdbPersonId: null,
      profilePath: null,
      notFound: true,
    })
    return { imageUrl: null, tmdbPersonId: null }
  }

  await upsertPersonTmdbCache({
    nameKey,
    tmdbPersonId: found.id,
    profilePath: found.profile_path,
    notFound: false,
  })

  const imageUrl = getImageUrl(found.profile_path, 'w185')
  return { imageUrl, tmdbPersonId: found.id }
}

/**
 * Ensure we have a TMDb person id (from cache or search) without requiring a separate image resolve pass.
 */
export async function resolveTmdbPersonId(decodedName: string): Promise<number | null> {
  const nameKey = normalizePersonNameKey(decodedName)
  const cached = await getPersonTmdbCacheRow(nameKey)

  if (notFoundStillTrusted(cached)) {
    return null
  }
  if (cached?.tmdb_person_id != null && !cached.not_found) {
    return cached.tmdb_person_id
  }

  const r = await resolveTmdbPersonProfileImageUrl(decodedName)
  return r.tmdbPersonId
}

/** How long a TMDb answer about a person's biography and dates is kept (7 days). */
export const PERSON_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface PersonDetailsRow {
  details_tmdb_person_id: number | null
  biography: string | null
  birthday: string | null
  deathday: string | null
  place_of_birth: string | null
  details_cached_at: Date | null
}

/**
 * TMDb's biography, dates and birthplace for a person, cached per name.
 * Null when TMDb could not be asked and nothing is stored for this person;
 * a person TMDb does not know answers with every field null.
 */
export async function getCachedOrFetchPersonDetails(
  decodedName: string,
  tmdbPersonId: number
): Promise<TmdbPersonDetails | null> {
  const nameKey = normalizePersonNameKey(decodedName)
  const row = await queryOne<PersonDetailsRow>(
    `SELECT details_tmdb_person_id, biography,
            to_char(birthday, 'YYYY-MM-DD') AS birthday,
            to_char(deathday, 'YYYY-MM-DD') AS deathday,
            place_of_birth, details_cached_at
     FROM person_tmdb_profile_cache WHERE name_key = $1`,
    [nameKey]
  )
  const stored =
    row?.details_cached_at != null && row.details_tmdb_person_id === tmdbPersonId
      ? {
          biography: row.biography,
          birthday: row.birthday,
          deathday: row.deathday,
          placeOfBirth: row.place_of_birth,
        }
      : null
  if (
    stored &&
    row?.details_cached_at &&
    Date.now() - new Date(row.details_cached_at).getTime() < PERSON_DETAILS_CACHE_TTL_MS
  ) {
    return stored
  }

  const answer = await tmdbLookup<TmdbPersonResponse>(`/person/${tmdbPersonId}`, {
    language: 'en-US',
  })
  if (answer.status === 'failed') {
    return stored
  }
  const details: TmdbPersonDetails =
    answer.status === 'ok'
      ? readTmdbPersonDetails(answer.data)
      : { biography: null, birthday: null, deathday: null, placeOfBirth: null }

  try {
    await query(
      `INSERT INTO person_tmdb_profile_cache (
         name_key, tmdb_person_id, not_found, details_tmdb_person_id,
         biography, birthday, deathday, place_of_birth, details_cached_at, updated_at
       ) VALUES ($1, $2, FALSE, $2, $3, $4::date, $5::date, $6, NOW(), NOW())
       ON CONFLICT (name_key) DO UPDATE SET
         details_tmdb_person_id = EXCLUDED.details_tmdb_person_id,
         biography = EXCLUDED.biography,
         birthday = EXCLUDED.birthday,
         deathday = EXCLUDED.deathday,
         place_of_birth = EXCLUDED.place_of_birth,
         details_cached_at = EXCLUDED.details_cached_at,
         updated_at = NOW()`,
      [
        nameKey,
        tmdbPersonId,
        details.biography,
        details.birthday,
        details.deathday,
        details.placeOfBirth,
      ]
    )
  } catch (err) {
    logger.warn({ err, nameKey }, 'Failed to persist TMDb person details cache')
  }
  return details
}

/**
 * Combined credits with optional 24h DB cache keyed by normalized name.
 */
export function getCachedOrFetchCombinedCredits(
  decodedName: string,
  tmdbPersonId: number
): Promise<TmdbCombinedCreditsResponse | null> {
  // The person page asks for these twice at once (its own request and the
  // credits-gap one): concurrent callers share one read, so a first visit
  // makes one TMDb request, not two.
  const key = `${normalizePersonNameKey(decodedName)}#${tmdbPersonId}`
  const pending = combinedCreditsInFlight.get(key)
  if (pending) return pending
  const read = readOrFetchCombinedCredits(decodedName, tmdbPersonId).finally(() => {
    combinedCreditsInFlight.delete(key)
  })
  combinedCreditsInFlight.set(key, read)
  return read
}

const combinedCreditsInFlight = new Map<string, Promise<TmdbCombinedCreditsResponse | null>>()

async function readOrFetchCombinedCredits(
  decodedName: string,
  tmdbPersonId: number
): Promise<TmdbCombinedCreditsResponse | null> {
  const nameKey = normalizePersonNameKey(decodedName)
  const row = await getPersonTmdbCacheRow(nameKey)
  const now = Date.now()

  if (
    row?.combined_credits_json &&
    row.combined_credits_cached_at &&
    now - new Date(row.combined_credits_cached_at).getTime() < COMBINED_CREDITS_CACHE_TTL_MS
  ) {
    return row.combined_credits_json as TmdbCombinedCreditsResponse
  }

  const credits = await getPersonCombinedCredits(tmdbPersonId)
  if (!credits) {
    logger.warn({ tmdbPersonId }, 'TMDb combined_credits returned null')
    return null
  }

  try {
    await upsertPersonCombinedCreditsCache(nameKey, tmdbPersonId, credits)
  } catch (err) {
    logger.warn({ err, nameKey }, 'Failed to persist combined credits cache')
  }

  return credits
}
