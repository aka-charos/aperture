import { docHeadings, docSummary, docTitle, type DocHeading } from './markdown'

/** One docs page, ready to render. */
export interface DocPage {
  slug: string
  /** Path from the repository root, which its relative links resolve against. */
  file: string
  title: string
  summary: string
  markdown: string
  headings: DocHeading[]
}

/** A guide's pages, addressed by slug. */
export type DocPages = ReadonlyMap<string, DocPage>

/**
 * Pages from an `import.meta.glob` of one docs folder. The glob's keys are
 * relative to the module that ran it, so the repository path is read back
 * from the `/docs/` segment rather than rebuilt, and the slug is the path
 * inside `folder` — `user-settings/preferences` for a page in a subfolder.
 */
export function buildDocPages(files: Record<string, string>, folder: string): DocPages {
  const pages = new Map<string, DocPage>()
  for (const [key, markdown] of Object.entries(files)) {
    const at = key.indexOf('/docs/')
    if (at === -1) continue
    const file = key.slice(at + 1)
    if (!file.startsWith(`${folder}/`) || !file.endsWith('.md')) continue
    const slug = file.slice(folder.length + 1, -'.md'.length)
    pages.set(slug, {
      slug,
      file,
      title: docTitle(markdown, slug),
      summary: docSummary(markdown),
      markdown,
      headings: docHeadings(markdown),
    })
  }
  return pages
}

const searchText = new WeakMap<DocPages, Map<string, string>>()

/**
 * Pages matching every word of a query, in the order given. Matches the whole
 * page, not only its title: "port 587" should find the SMTP page, and nobody
 * remembers which page a thing is on — that is the question.
 */
export function filterDocPages(pages: DocPages, slugs: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...slugs]

  let text = searchText.get(pages)
  if (!text) {
    text = new Map([...pages.values()].map((p) => [p.slug, `${p.title}\n${p.markdown}`.toLowerCase()]))
    searchText.set(pages, text)
  }
  return slugs.filter((slug) => {
    const haystack = text?.get(slug)
    return haystack ? words.every((w) => haystack.includes(w)) : false
  })
}
