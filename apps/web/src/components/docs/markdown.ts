/**
 * What a guide needs to know about a page before rendering it: its title,
 * a one-line summary for the index, and the anchor of every heading.
 *
 * Shared by the admin guide and the user guide. Pure and DOM-free so both
 * guides' tests can run it over the real files. The pages are written for
 * GitHub first, so the anchors follow GitHub's rule — that is what every
 * `page.md#fragment` link in `docs/` was written against, and a different
 * rule would break them silently.
 */

export interface DocHeading {
  /** 1-based source line, matching the positions react-markdown hands a component. */
  line: number
  depth: number
  text: string
  slug: string
}

/** Inline markdown reduced to the words a reader sees. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * GitHub's heading anchor: lower case, everything but letters, numbers,
 * spaces, hyphens and underscores removed, and each space a hyphen. Spaces are
 * not collapsed — "Logo & Favicon" is `logo--favicon` on GitHub too.
 */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-')
}

/**
 * Every ATX heading outside a code fence, with GitHub's anchors — a repeated
 * heading gets `-1`, `-2` as it does there. Fences matter: the deployment
 * pages carry shell blocks whose `# comments` are not headings.
 */
export function docHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = []
  const seen = new Map<string, number>()
  let fence: string | null = null

  markdown.split(/\r?\n/).forEach((raw, index) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      return
    }
    if (fence !== null) return

    const match = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw)
    if (!match) return

    const text = stripInlineMarkdown(match[2])
    const base = githubSlug(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)

    headings.push({
      line: index + 1,
      depth: match[1].length,
      text,
      slug: count === 0 ? base : `${base}-${count}`,
    })
  })

  return headings
}

/** The page's `# Title`, or the file name when a page has none. */
export function docTitle(markdown: string, fallback: string): string {
  return docHeadings(markdown).find((h) => h.depth === 1)?.text || fallback
}

/**
 * The first paragraph under the title, as plain text — the line the index
 * shows under each page's name. Every page opens with one, by convention
 * rather than by rule, so a page without it shows no summary rather than its
 * first table row or image caption.
 */
export function docSummary(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const titleIndex = lines.findIndex((l) => /^#\s/.test(l))
  const paragraph: string[] = []

  for (const line of lines.slice(titleIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length) break
      continue
    }
    if (paragraph.length === 0 && /^(#|\||!\[|>|[-*+]\s|\d+\.\s|```|---)/.test(trimmed)) {
      // Not a paragraph: the page opens on something else.
      return ''
    }
    paragraph.push(trimmed)
  }

  return stripInlineMarkdown(paragraph.join(' '))
}
