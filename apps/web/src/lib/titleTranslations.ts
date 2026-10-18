/**
 * The translated overviews poster cards show, fetched in batches.
 *
 * Every card on a page asks for its own title (`useLocalizedOverview` in
 * @aperture/ui); the asks made in one tick are gathered and sent as a few
 * GET /api/title-translations/overviews requests, the same one-lookup-per-page
 * shape as watch status. Answers are kept per language for the life of the
 * tab, "no translation" included, so paging back and forth asks nothing twice.
 *
 * In memory only: a translation is a fact about a title and a language, not
 * about the viewer, and the server answers only titles the viewer may open.
 */
import type { LocalizedTextStore, TitleRef } from '@aperture/ui'

/** Ids per media type per request; the route refuses more. */
const BATCH_SIZE = 100
/** How long asks are gathered before a request goes out. */
const GATHER_MS = 25

interface OverviewsResponse {
  movies?: Record<string, string>
  series?: Record<string, string>
}

const keyOf = (ref: TitleRef) => `${ref.mediaType}:${ref.id}`

export function createTitleTranslationStore(): LocalizedTextStore & {
  setLanguage(language: string): void
} {
  let language = ''
  // undefined = never asked; null = asked, no translation.
  let answers = new Map<string, string | null>()
  const queued = new Map<string, TitleRef>()
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const notify = () => listeners.forEach((listener) => listener())

  async function send(lang: string, refs: TitleRef[]) {
    const params = new URLSearchParams({ lang })
    for (const ref of refs) params.append(ref.mediaType, ref.id)
    let body: OverviewsResponse = {}
    try {
      const response = await fetch(`/api/title-translations/overviews?${params}`, {
        credentials: 'include',
      })
      if (response.ok) body = (await response.json()) as OverviewsResponse
    } catch {
      // A failed lookup leaves the originals showing; it is not worth an error.
    }
    // The language changed while this was in flight: these answers are for a
    // page nobody is looking at any more.
    if (lang !== language) return
    for (const ref of refs) {
      const text = (ref.mediaType === 'movie' ? body.movies : body.series)?.[ref.id]
      answers.set(keyOf(ref), text ?? null)
    }
    notify()
  }

  function flush() {
    timer = null
    if (!language) return
    const movies: TitleRef[] = []
    const series: TitleRef[] = []
    for (const ref of queued.values()) (ref.mediaType === 'movie' ? movies : series).push(ref)
    queued.clear()
    while (movies.length > 0 || series.length > 0) {
      void send(language, [...movies.splice(0, BATCH_SIZE), ...series.splice(0, BATCH_SIZE)])
    }
  }

  return {
    overview(ref) {
      return answers.get(keyOf(ref)) ?? undefined
    },
    request(ref) {
      const key = keyOf(ref)
      if (answers.has(key) || queued.has(key)) return
      // Marked as asked at once, so the cards rendering in this same tick do
      // not queue the title again while the request is out.
      answers.set(key, null)
      queued.set(key, ref)
      if (!timer) timer = setTimeout(flush, GATHER_MS)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setLanguage(next) {
      if (next === language) return
      const wasSet = language !== ''
      language = next
      if (!wasSet) {
        // Asks made before the language was known are sent now.
        if (queued.size > 0 && !timer) timer = setTimeout(flush, GATHER_MS)
        return
      }
      // A new language: forget every answer and ask again for whatever is on
      // screen, which re-requests itself when the cards re-render.
      const pending = [...answers.keys()]
      answers = new Map()
      queued.clear()
      for (const key of pending) {
        const [mediaType, id] = key.split(':') as [TitleRef['mediaType'], string]
        answers.set(key, null)
        queued.set(key, { mediaType, id })
      }
      if (queued.size > 0 && !timer) timer = setTimeout(flush, GATHER_MS)
      notify()
    },
  }
}
