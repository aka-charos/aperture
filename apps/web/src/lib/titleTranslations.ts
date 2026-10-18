/**
 * The translated overviews poster cards show, fetched in batches.
 *
 * Every card on a page asks for its own title (`useLocalizedOverview` in
 * @aperture/ui); the asks made in one tick are gathered and sent as a few
 * GET /api/title-translations/overviews requests, the same one-lookup-per-page
 * shape as watch status. Answers are kept for the tab, "no translation"
 * included, so paging back and forth asks nothing twice.
 *
 * Forgetting is done by bumping the epoch, never by re-queuing what was known:
 * the cards still mounted ask again on their own, so a language change costs
 * one lookup for what is on screen, not for every title the tab ever showed.
 */
import type { LocalizedTextStore, TitleRef } from '@aperture/ui'

/**
 * Ids per request, both media types together. A uuid parameter is ~44
 * characters, so 60 keeps the request line near 2.7 KB — well inside the 8 KB
 * a default nginx in front of the app accepts.
 */
const BATCH_SIZE = 60
/** How long asks are gathered before a request goes out. */
const GATHER_MS = 25
/** A failed lookup is retried this many times in a row, further apart each time. */
const MAX_RETRIES = 3
const RETRY_BASE_MS = 5_000

interface OverviewsResponse {
  movies?: Record<string, string>
  series?: Record<string, string>
}

const keyOf = (ref: TitleRef) => `${ref.mediaType}:${ref.id}`

export type TitleTranslationStore = LocalizedTextStore & {
  /** The language the page is displayed in; a change forgets every answer. */
  setLanguage(language: string): void
  /** Forget every answer (a different viewer). */
  reset(): void
}

export function createTitleTranslationStore(): TitleTranslationStore {
  let language = ''
  let epoch = 0
  // A key present: answered (null = no translation). Absent: never asked, or
  // forgotten after a failure so the card asks again.
  let answers = new Map<string, string | null>()
  const queued = new Map<string, TitleRef>()
  const inFlight = new Set<string>()
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  // The epoch at the last forget, so a response from before it is dropped even
  // when the language came back to the same value.
  let epochAtForget = 0

  const notify = () => listeners.forEach((listener) => listener())

  function forget() {
    answers = new Map()
    queued.clear()
    inFlight.clear()
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    failures = 0
    epoch += 1
    epochAtForget = epoch
    notify()
  }

  function scheduleRetry() {
    if (failures > MAX_RETRIES || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      epoch += 1
      notify()
    }, RETRY_BASE_MS * failures)
  }

  async function send(lang: string, round: number, refs: TitleRef[]) {
    const params = new URLSearchParams({ lang })
    for (const ref of refs) params.append(ref.mediaType, ref.id)
    let body: OverviewsResponse | null = null
    try {
      const response = await fetch(`/api/title-translations/overviews?${params}`, {
        credentials: 'include',
      })
      if (response.ok) body = (await response.json()) as OverviewsResponse
    } catch {
      // Handled below as a failed lookup.
    }
    // Forgotten while in flight (a new language or viewer): nobody wants these.
    if (lang !== language || round !== epochAtForget) return
    for (const ref of refs) inFlight.delete(keyOf(ref))
    if (!body) {
      // Not remembered as "no translation": the cards ask again on retry.
      failures += 1
      scheduleRetry()
      return
    }
    failures = 0
    for (const ref of refs) {
      const text = (ref.mediaType === 'movie' ? body.movies : body.series)?.[ref.id]
      answers.set(keyOf(ref), text ?? null)
    }
    notify()
  }

  function flush() {
    timer = null
    if (!language) return
    const refs = [...queued.values()]
    queued.clear()
    for (let i = 0; i < refs.length; i += BATCH_SIZE) {
      void send(language, epochAtForget, refs.slice(i, i + BATCH_SIZE))
    }
  }

  return {
    overview(ref) {
      return answers.get(keyOf(ref)) ?? undefined
    },
    request(ref) {
      // Before the language is known nothing is asked; setting it bumps the
      // epoch and the cards ask again.
      if (!language) return
      const key = keyOf(ref)
      if (answers.has(key) || queued.has(key) || inFlight.has(key)) return
      queued.set(key, ref)
      inFlight.add(key)
      if (!timer) timer = setTimeout(flush, GATHER_MS)
    },
    epoch() {
      return epoch
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setLanguage(next) {
      if (next === language) return
      language = next
      forget()
    },
    reset() {
      forget()
    },
  }
}
