import { docHeadings, docSummary, docTitle, type DocHeading } from './markdown'

/**
 * The admin guide, compiled into the bundle from `docs/admin/`.
 *
 * Built in rather than served, so the guide an instance shows is the one
 * written for the code it runs — the same commit, never a newer page about a
 * setting this build does not have. The folder is the source of truth and
 * reads on GitHub as before; nothing is copied.
 *
 * Eager inside a module only the guide imports: the page and the drawer are
 * both lazy, so the ~170 KB of markdown is one chunk an admin downloads the
 * first time they open help, and nobody else ever does. Screenshots are not
 * imported — they show the console before it was redesigned, and the reader
 * is looking at the real one.
 */
const FILES = import.meta.glob<string>('../../../../../../docs/admin/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export interface AdminDoc {
  slug: string
  title: string
  summary: string
  markdown: string
  headings: DocHeading[]
}

const DOCS = new Map<string, AdminDoc>(
  Object.entries(FILES).map(([path, markdown]) => {
    const slug = path.slice(path.lastIndexOf('/') + 1, -'.md'.length)
    return [
      slug,
      {
        slug,
        title: docTitle(markdown, slug),
        summary: docSummary(markdown),
        markdown,
        headings: docHeadings(markdown),
      },
    ]
  })
)

export function getAdminDoc(slug: string): AdminDoc | undefined {
  return DOCS.get(slug)
}

/** Lower-cased page text for the index filter, built once on first use. */
let searchText: Map<string, string> | null = null

/**
 * Pages matching every word of a query, in the order given. Matches the whole
 * page, not only its title: "port 587" should find the SMTP page, and nobody
 * remembers which page a setting is on — that is the question.
 */
export function filterAdminDocs(slugs: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...slugs]

  searchText ??= new Map(
    [...DOCS.values()].map((d) => [d.slug, `${d.title}\n${d.markdown}`.toLowerCase()])
  )
  return slugs.filter((slug) => {
    const text = searchText?.get(slug)
    return text ? words.every((w) => text.includes(w)) : false
  })
}
