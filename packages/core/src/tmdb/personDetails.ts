/**
 * A TMDb person's biography, birth and death dates and birthplace, read from
 * `GET /person/{id}`. Pure; pinned by `personDetails.test.ts`.
 *
 * The person page shows the media server's Person metadata first. Emby and
 * Jellyfin fill that in only when they refresh the person, so for most of a
 * library's people it is empty; TMDb fills each empty field.
 */

export interface TmdbPersonDetails {
  biography: string | null
  /** `YYYY-MM-DD` */
  birthday: string | null
  /** `YYYY-MM-DD` */
  deathday: string | null
  placeOfBirth: string | null
}

export interface TmdbPersonResponse {
  biography?: string | null
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date in `YYYY-MM-DD`, else null (TMDb sends '' and partial dates). */
export function tmdbDate(value: string | null | undefined): string | null {
  const text = value?.trim() ?? ''
  const match = DATE.exec(text)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return text
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function readTmdbPersonDetails(raw: TmdbPersonResponse): TmdbPersonDetails {
  return {
    biography: text(raw.biography),
    birthday: tmdbDate(raw.birthday),
    deathday: tmdbDate(raw.deathday),
    placeOfBirth: text(raw.place_of_birth),
  }
}
