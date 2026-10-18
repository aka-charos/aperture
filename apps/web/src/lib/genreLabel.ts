/**
 * Genre names as the reader's language prints them.
 *
 * Genres are stored as the English names the media server sends (TMDb's
 * vocabulary, plus a few Emby adds), and they stay English everywhere they are
 * COMPARED — filters, weights, the recommender. Only what is printed goes
 * through here. A genre with no string under `genres.*` prints as stored, so a
 * name nobody anticipated still reads, just untranslated.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

/**
 * The key a genre's string lives under: lowercase, every run of anything that
 * is not a letter or digit turned into one underscore. "Sci-Fi & Fantasy" →
 * `sci_fi_fantasy`, "Science Fiction" → `science_fiction`.
 */
export function genreKey(genre: string): string {
  return genre
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function genreLabel(t: TFunction, genre: string): string {
  const key = genreKey(genre)
  if (!key) return genre
  return t(`genres.${key}`, { defaultValue: genre })
}

/** `genreLabel` bound to the current language, stable until it changes. */
export function useGenreLabel(): (genre: string) => string {
  const { t } = useTranslation()
  return useCallback((genre: string) => genreLabel(t, genre), [t])
}
