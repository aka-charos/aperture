/**
 * Drop a retrieved page that repeats another page's title.
 *
 * WHY THIS EXISTS. The Kontroll bench retrieved one book chapter twice - the
 * publisher's paywall page and an academia.edu copy, both titled "Inhabiting
 * the Post-Communist (Kontroll. Nimród Antal, 2003)" - and the budget gave the
 * two about 28,000 of 64,000 characters: an abstract, a reference list and a
 * page of unrelated "related papers". One of them is enough, and the space goes
 * back to pages that differ.
 *
 * THE TEXT IS NOT COMPARED, because in that case it did not match: each site
 * wrapped the chapter in its own furniture. The title is what the two had in
 * common, so the title decides.
 *
 * A GENERIC TITLE IS NEVER A DUPLICATE. Two different reviews can both be
 * called "Control (2003) - Review", and dropping one would lose a source
 * without a trace - the failure ./blockedPage.ts is built to avoid. So a title
 * counts only when something specific is left after the film's own names and
 * year are taken out of it. Keeping a true duplicate costs budget; dropping a
 * different page costs a source, so the test errs toward keeping.
 *
 * Of two duplicates the longer text is kept, in the first one's place, since
 * the search engine's order is the only ranking there is.
 *
 * PURE AND DB-FREE, like ./blockedPage.ts, which runs just before it.
 */

/** Letters that must remain once the film's names are removed. */
export const DISTINCTIVE_TITLE_LETTERS = 20

const fold = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim()

/** The title's key, or null when it is too generic to identify a page. */
function titleKey(title: string, filmNames: readonly string[]): string | null {
  const key = fold(title)
  let remainder = key
  for (const name of filmNames.map(fold).filter(Boolean)) {
    remainder = remainder.split(name).join(' ')
  }
  const letters = remainder.match(/\p{L}/gu)?.length ?? 0
  return letters >= DISTINCTIVE_TITLE_LETTERS ? key : null
}

export function dropDuplicateTitles<T extends { title: string; text: string }>(
  sources: readonly T[],
  filmNames: readonly string[]
): { kept: T[]; dropped: T[] } {
  const kept: T[] = []
  const dropped: T[] = []
  const slotByKey = new Map<string, number>()

  for (const source of sources) {
    const key = titleKey(source.title, filmNames)
    const slot = key === null ? undefined : slotByKey.get(key)
    if (slot === undefined) {
      if (key !== null) slotByKey.set(key, kept.length)
      kept.push(source)
      continue
    }
    if (source.text.trim().length > kept[slot].text.trim().length) {
      dropped.push(kept[slot])
      kept[slot] = source
    } else {
      dropped.push(source)
    }
  }
  return { kept, dropped }
}

/**
 * Keep the best-ranked page from each host, and drop the rest.
 *
 * WHY A SECOND DEDUPE. The title test above cannot see two pages that carry the
 * same material under different names. On the second Requiem for a Dream bench,
 * imdb.com supplied both its title page and its Metacritic-reviews page, and
 * rogerebert.com supplied both a review and a director index - four of eleven
 * slots on two hosts, one of which had already been shown to be worthless. A
 * slot is a page fetched, scraped and paid for, so a second page from a host
 * already represented is the cheapest thing in the retrieval to give up.
 *
 * THE FIRST ONE IS THE ONE TO KEEP, because the order here is relevance order
 * with criticism ahead of it - so "first" is the best-ranked page that host
 * offered, which on that bench meant the Ebert review over the index and the
 * Metacritic quotes over the title page.
 *
 * THE HOST IS THE KEY, NOT THE REGISTRABLE DOMAIN. Telling `framerated.co.uk`
 * from `bbc.co.uk` needs a public-suffix list, and without one the two-label
 * rule would fold every British site into `co.uk`. Comparing hosts with `www.`
 * removed treats `en.wikipedia.org` and `simple.wikipedia.org` as different,
 * which is right - they are different articles - and misses a site serving one
 * article from two subdomains, which nothing has yet been seen to do.
 */
export function keepOnePerDomain<T extends { domain: string }>(
  sources: readonly T[]
): { kept: T[]; dropped: { domain: string }[] } {
  const seen = new Set<string>()
  const kept: T[] = []
  const dropped: { domain: string }[] = []
  for (const source of sources) {
    const host = source.domain.trim().toLowerCase().replace(/^www\./, '')
    if (host && seen.has(host)) {
      dropped.push({ domain: source.domain })
      continue
    }
    if (host) seen.add(host)
    kept.push(source)
  }
  return { kept, dropped }
}
