/**
 * An English heading anchor, carried onto the page a reader actually sees.
 *
 * Inline ? icons and tour steps name a section by its ENGLISH heading id
 * (`understanding-a-pick-in-depth`), but a translated page's ids are its own
 * headings' (`μια-πρόταση-σε-βάθος`), so the English id names nothing there
 * and the drawer opened at the top. A translation mirrors the English page
 * heading for heading, so the section is the heading at the same position —
 * and only when it is also at the same depth, which is what says the two
 * pages still line up there. Otherwise the page opens at the top: the right
 * page without the scroll beats a scroll to the wrong section.
 *
 * Pure, pinned by `tours.test.ts` against every anchor the app names and
 * every translated page.
 */

interface Heading {
  slug: string
  depth: number
}

export function translatedAnchor(
  english: readonly Heading[] | undefined,
  shown: readonly Heading[] | undefined,
  anchor: string | undefined
): string | undefined {
  if (!anchor || !english || !shown) return undefined
  if (shown === english) return anchor
  const index = english.findIndex((h) => h.slug === anchor)
  if (index < 0) return undefined
  const match = shown[index]
  return match && match.depth === english[index].depth ? match.slug : undefined
}
