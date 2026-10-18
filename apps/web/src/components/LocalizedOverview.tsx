import { useLocalizedOverview, type TitleRef } from '@aperture/ui'

/**
 * A library title's overview in the page's language, for rows rendered inside a
 * `.map()` where the hook cannot be called directly. Prints `fallback` when the
 * title has no overview at all.
 */
export function LocalizedOverview({
  titleRef,
  text,
  fallback,
}: {
  titleRef: TitleRef
  text: string | null | undefined
  fallback?: string
}) {
  const overview = useLocalizedOverview(titleRef, text)
  return <>{overview || fallback}</>
}
