import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'

/** A library title, as the translation lookup addresses it. */
export interface TitleRef {
  mediaType: 'movie' | 'series'
  id: string
}

/**
 * Where a card's translated overview comes from. This package has no API
 * client, so the app supplies the store; every poster asks it for its own
 * title, and the store batches those asks into a few requests per page.
 */
export interface LocalizedTextStore {
  /**
   * The translated overview, or undefined when there is none or the answer has
   * not arrived. Must return the same value between notifications, since it is
   * read as a `useSyncExternalStore` snapshot.
   */
  overview(ref: TitleRef): string | undefined
  /** Ask for a title's translation. Repeated asks for one title cost nothing. */
  request(ref: TitleRef): void
  subscribe(listener: () => void): () => void
}

export const LocalizedTextContext = createContext<LocalizedTextStore | null>(null)

const noSubscription = () => () => {}

/**
 * The overview to show for a title: its translation into the language the page
 * is displayed in when one exists, else the original. With no store mounted, no
 * ref (a TMDb card that is not a library title), or no original text, the
 * original is returned untouched.
 */
export function useLocalizedOverview(
  ref: TitleRef | undefined,
  original: string | null | undefined
): string | null | undefined {
  const store = useContext(LocalizedTextContext)
  const mediaType = ref?.mediaType
  const id = ref?.id
  const wanted = !!store && !!mediaType && !!id && !!original

  useEffect(() => {
    if (wanted) store!.request({ mediaType: mediaType!, id: id! })
  }, [wanted, store, mediaType, id])

  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noSubscription()),
    [store]
  )
  const translated = useSyncExternalStore(subscribe, () =>
    wanted ? store!.overview({ mediaType: mediaType!, id: id! }) : undefined
  )
  return translated ?? original
}
