/**
 * Genre names as the reader's language prints them.
 *
 * Genres are stored as the English names the media server sends (TMDb's
 * vocabulary, plus a few Emby adds), and they stay English everywhere they are
 * COMPARED — filters, weights, the recommender. Only what is printed goes
 * through here, in this order:
 *
 *   1. `genres.<key>` in the page's own language — hand-written strings (en,
 *      el) and anything an operator overrides. Read from that language's
 *      bundle only: falling back to English here would hide step 2.
 *   2. `genresTmdb.<key>` — TMDb's own name for the genre in that language,
 *      loaded by `loadTmdbGenreNames`, which is what covers every other locale.
 *   3. The stored name.
 */
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n/config'

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

/** The bundle a language's strings live in (`el-GR` → `el`), as config.ts keys them. */
function bundleLanguage(): string {
  return (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0]
}

function ownString(lng: string, path: string): string | null {
  const value: unknown = i18n.getResource(lng, 'translation', path)
  return typeof value === 'string' && value.trim() ? value : null
}

export function genreLabel(genre: string): string {
  const key = genreKey(genre)
  if (!key) return genre
  const lng = bundleLanguage()
  return ownString(lng, `genres.${key}`) ?? ownString(lng, `genresTmdb.${key}`) ?? genre
}

/**
 * `genreLabel` for a component. Subscribing to i18next is the point: the
 * component re-renders on a language change and after strings are added
 * (config.ts and loadTmdbGenreNames nudge it), which is what re-labels. The
 * function itself is stable, so do not memoize labels on its identity.
 */
export function useGenreLabel(): (genre: string) => string {
  useTranslation()
  return genreLabel
}

const tmdbNamesLoaded = new Set<string>()

/**
 * Load TMDb's names for the stored genres in `language` into the i18n bundle
 * under `genresTmdb`, once per language per tab. Never throws: without them the
 * page prints its own strings or the stored names.
 */
export async function loadTmdbGenreNames(language: string): Promise<void> {
  const lng = language.split('-')[0]
  if (!lng || lng === 'en' || tmdbNamesLoaded.has(lng)) return
  tmdbNamesLoaded.add(lng)
  try {
    const response = await fetch(`/api/title-translations/genres?lang=${encodeURIComponent(lng)}`, {
      credentials: 'include',
    })
    if (!response.ok) {
      tmdbNamesLoaded.delete(lng)
      return
    }
    const data = (await response.json()) as { names?: Record<string, string> }
    const keyed: Record<string, string> = {}
    for (const [english, localized] of Object.entries(data.names ?? {})) {
      const key = genreKey(english)
      if (key && localized) keyed[key] = localized
    }
    if (Object.keys(keyed).length === 0) return
    i18n.addResourceBundle(lng, 'translation', { genresTmdb: keyed }, true, true)
    // The same re-render nudge the runtime overrides use (i18n/config.ts).
    void i18n.changeLanguage(i18n.language)
  } catch {
    tmdbNamesLoaded.delete(lng)
  }
}
