import { resolveDocHref, slugInFolder } from '@/components/docs/docLinks'
import { USER_DOCS_FOLDER, canonicalDocPath } from '@/components/docs/guidePaths'
import { stripInlineMarkdown } from '@/components/docs/markdown'

export interface GuideItem {
  slug: string
  /** The one line the table of contents gives the page. */
  blurb: string
}

export interface GuideSection {
  heading: string
  items: GuideItem[]
}

/**
 * The user guide's contents, read out of `docs/user-guide.md` rather than
 * written a second time: that file already groups and orders the pages for
 * GitHub, and two copies of one table of contents disagree the first time a
 * page is added to one of them.
 *
 * A section is a `## heading`; an entry is a list item opening on a link to a
 * user page, with its description after a dash. Anything else — the intro,
 * the link to the admin guide, the quick-reference table — is left out, and a
 * section with no user pages in it is dropped. `guide.test.ts` fails on a page
 * the contents do not reach. Pure.
 */
export function parseGuideIndex(
  markdown: string,
  fromFile: string,
  isUserPage: (slug: string) => boolean
): GuideSection[] {
  const sections: GuideSection[] = []
  let current: GuideSection | null = null
  let inFence = false

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = /^##\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      current = { heading: stripInlineMarkdown(heading[1]), items: [] }
      sections.push(current)
      continue
    }

    const item = /^\s*(?:\d+\.|[-*+])\s+\[[^\]]*\]\(([^)\s]+)\)\s*(?:[-–—:]\s*(.*))?$/.exec(line)
    if (!item || !current) continue

    const link = resolveDocHref(item[1], fromFile)
    if (link.kind !== 'file') continue
    const slug = slugInFolder(canonicalDocPath(link.path), USER_DOCS_FOLDER)
    if (!slug || !isUserPage(slug) || current.items.some((i) => i.slug === slug)) continue

    current.items.push({ slug, blurb: stripInlineMarkdown(item[2] ?? '') })
  }

  return sections.filter((s) => s.items.length > 0)
}
