/**
 * The guide's page layout, read off the shape of the markdown.
 *
 * The pages are written for GitHub and must stay plain markdown there, so
 * nothing here asks an author for new syntax: every pattern below is one the
 * pages already use. A rehype pass rewrites the tree before React sees it,
 * and `DocMarkdown` draws each marked element (`data-doc`):
 *
 * - `lede`     the first paragraph under the title
 * - `toc`      "On this page", placed before the first section (3+ sections)
 * - `section`  each `##` heading and everything up to the next one; the
 *              heading carries its number (`data-index`)
 * - `terms`    a two-column table, as a term list (`dl`); wider tables stay
 * - `features` a top-level bullet list, each item a `feature`; one opening on
 *              bold followed by a dash or colon splits into `term` and `desc`
 * - `ui`       words in quotes ("…", “…”, «…»): what the screen says
 * - `callout`  a blockquote opening on bold or on a GitHub alert (`[!TIP]`),
 *              with `data-tone` info or warning
 * - `example`  a blockquote that is one quoted line: something to type
 * - `next`     a closing `**Next:** [Page](page.md)` paragraph
 *
 * A `---` between sections is dropped, since the cards separate them.
 *
 * Pure and DOM-free; the types are the few hast fields it touches, so the web
 * bundle needs no hast dependency of its own.
 */

export interface HastText {
  type: 'text'
  value: string
}

export interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastNode[]
  position?: unknown
}

export type HastNode = HastText | HastElement | { type: 'comment' | 'raw' | 'doctype'; value?: string }

export interface HastRoot {
  type: 'root'
  children: HastNode[]
}

/** Below this many sections a page is short enough to read without a contents strip. */
export const TOC_MIN_SECTIONS = 3

/** Quoted words longer than this are a sentence, not something on screen. */
const UI_LABEL_MAX_CHARS = 48

const QUOTED = new RegExp(
  `"([^"\\n]{1,${UI_LABEL_MAX_CHARS}})"|\u201c([^\u201d\\n]{1,${UI_LABEL_MAX_CHARS}})\u201d|\u00ab([^\u00bb\\n]{1,${UI_LABEL_MAX_CHARS}})\u00bb`,
  'g'
)

/** A term followed by its description: "**Term** — text", "**Term**: text". */
const TERM_SEPARATOR = /^\s*(?:[\u2014\u2013-]|:)\s+/

const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i

const NO_UI_LABELS = new Set(['code', 'pre', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'])

function isElement(node: HastNode | undefined): node is HastElement {
  return node?.type === 'element'
}

function isBlank(node: HastNode): boolean {
  return node.type === 'text' && !(node as HastText).value.trim()
}

function element(tagName: string, properties: Record<string, unknown>, children: HastNode[]): HastElement {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): HastText {
  return { type: 'text', value }
}

/** The children that are not whitespace between elements. */
function meaningful(children: HastNode[]): HastNode[] {
  return children.filter((c) => !isBlank(c))
}

export function textContent(node: HastNode): string {
  if (node.type === 'text') return (node as HastText).value
  if (isElement(node)) return node.children.map(textContent).join('')
  return ''
}

// ── The page: lede, sections, contents, next ─────────────────────────────

/** `**Next:** [Page](page.md)`: bold label, one link, nothing else. */
function readNextLink(node: HastNode): { label: string; link: HastElement } | null {
  if (!isElement(node) || node.tagName !== 'p') return null
  const parts = meaningful(node.children)
  if (parts.length !== 2) return null
  const [label, link] = parts
  if (!isElement(label) || label.tagName !== 'strong' || !isElement(link) || link.tagName !== 'a') return null
  const words = textContent(label).trim()
  if (!words.endsWith(':')) return null
  return { label: words.slice(0, -1).trim(), link }
}

function layoutPage(root: HastRoot): void {
  let children = root.children.filter((c) => !(isElement(c) && c.tagName === 'hr'))

  // The closing "Next" link sits outside the last section.
  let next: HastElement | null = null
  const lastIndex = children.map((c, i) => (isBlank(c) ? -1 : i)).filter((i) => i >= 0).pop()
  if (lastIndex != null) {
    const found = readNextLink(children[lastIndex])
    if (found) {
      next = element('div', { dataDoc: 'next', dataLabel: found.label }, [found.link])
      children = children.slice(0, lastIndex)
    }
  }

  const firstSection = children.findIndex((c) => isElement(c) && c.tagName === 'h2')
  const intro = firstSection === -1 ? children : children.slice(0, firstSection)
  const lede = intro.find((c): c is HastElement => isElement(c) && c.tagName !== 'h1')
  if (lede && lede.tagName === 'p') lede.properties = { ...lede.properties, dataDoc: 'lede' }

  const out: HastNode[] = [...intro]
  if (firstSection !== -1) {
    const sections: HastElement[] = []
    for (const node of children.slice(firstSection)) {
      if (isElement(node) && node.tagName === 'h2') {
        node.properties = { ...node.properties, dataIndex: sections.length + 1 }
        sections.push(element('section', { dataDoc: 'section' }, [node]))
      } else {
        sections[sections.length - 1].children.push(node)
      }
    }
    if (sections.length >= TOC_MIN_SECTIONS) out.push(element('nav', { dataDoc: 'toc' }, []))
    out.push(...sections)
  }
  if (next) out.push(next)
  root.children = out
}

// ── Blocks anywhere: term tables, feature lists, callouts ────────────────

function cellsOf(row: HastElement): HastElement[] {
  return row.children.filter((c): c is HastElement => isElement(c) && (c.tagName === 'td' || c.tagName === 'th'))
}

function rowsOf(section: HastElement | undefined): HastElement[] {
  return (section?.children ?? []).filter((c): c is HastElement => isElement(c) && c.tagName === 'tr')
}

/** A two-column table as a term list, or null when it is wider (or ragged). */
function termList(table: HastElement): HastElement | null {
  const head = table.children.find((c): c is HastElement => isElement(c) && c.tagName === 'thead')
  const body = table.children.find((c): c is HastElement => isElement(c) && c.tagName === 'tbody')
  const header = rowsOf(head)[0]
  const rows = rowsOf(body)
  if (!header || cellsOf(header).length !== 2 || rows.length === 0) return null
  if (!rows.every((r) => cellsOf(r).length === 2)) return null
  const items: HastNode[] = []
  for (const row of rows) {
    const [term, desc] = cellsOf(row)
    items.push(element('dt', {}, term.children), element('dd', {}, desc.children))
  }
  return element('dl', { dataDoc: 'terms' }, items)
}

/** "**Term** — description": the term and what follows, or null. */
function splitTerm(children: HastNode[]): { term: HastNode[]; desc: HastNode[] } | null {
  const lead = children.findIndex((c) => !isBlank(c))
  const strong = children[lead]
  if (!isElement(strong) || strong.tagName !== 'strong') return null
  const rest = children.slice(lead + 1)
  const label = textContent(strong).trim()
  if (label.endsWith(':')) {
    const first = rest[0]
    if (first?.type === 'text') rest[0] = text((first as HastText).value.replace(/^\s+/, ''))
    return { term: [text(label.slice(0, -1).trim())], desc: rest }
  }
  const after = rest[0]
  if (after?.type !== 'text') return null
  const value = (after as HastText).value
  if (!TERM_SEPARATOR.test(value)) return null
  return { term: strong.children, desc: [text(value.replace(TERM_SEPARATOR, '')), ...rest.slice(1)] }
}

function layoutFeatureList(list: HastElement): void {
  list.properties = { ...list.properties, dataDoc: 'features' }
  for (const item of list.children) {
    if (!isElement(item) || item.tagName !== 'li') continue
    item.properties = { ...item.properties, dataDoc: 'feature' }
    // A loose list wraps each item's text in a paragraph.
    const first = meaningful(item.children)[0]
    const host = isElement(first) && first.tagName === 'p' ? first : item
    const split = splitTerm(host.children)
    if (!split) continue
    host.children = [
      element('span', { dataDoc: 'term' }, split.term),
      element('span', { dataDoc: 'desc' }, split.desc),
    ]
  }
}

function layoutBlockquote(quote: HastElement): void {
  const blocks = meaningful(quote.children)
  const first = blocks[0]
  if (!isElement(first) || first.tagName !== 'p') return

  const opening = first.children[0]
  const alert = opening?.type === 'text' ? ALERT.exec((opening as HastText).value) : null
  if (alert) {
    const kind = alert[1].toUpperCase()
    first.children[0] = text((opening as HastText).value.slice(alert[0].length))
    if (!textContent(first).trim() && meaningful(first.children).every((c) => c.type === 'text')) {
      quote.children = quote.children.filter((c) => c !== first)
    }
    quote.properties = {
      ...quote.properties,
      dataDoc: 'callout',
      dataTone: kind === 'WARNING' || kind === 'CAUTION' ? 'warning' : 'info',
    }
    return
  }

  const lead = meaningful(first.children)[0]
  if (isElement(lead) && lead.tagName === 'strong') {
    quote.properties = { ...quote.properties, dataDoc: 'callout', dataTone: 'info' }
    return
  }

  // One quoted line and nothing else: an example of something to type.
  if (blocks.length === 1 && first.children.every((c) => c.type === 'text')) {
    const said = textContent(first).trim()
    const quoted = /^(?:"([^"]+)"|\u201c([^\u201d]+)\u201d|\u00ab([^\u00bb]+)\u00bb)$/.exec(said)
    if (quoted) {
      first.children = [text(quoted[1] ?? quoted[2] ?? quoted[3])]
      quote.properties = { ...quote.properties, dataDoc: 'example' }
    }
  }
}

function layoutBlocks(parent: HastElement | HastRoot, topLevel: boolean): void {
  parent.children = parent.children.map((node) => {
    if (!isElement(node)) return node
    if (node.tagName === 'table') {
      const terms = termList(node)
      if (terms) return terms
    }
    if (node.tagName === 'blockquote') layoutBlockquote(node)
    if (node.tagName === 'ul' && topLevel) layoutFeatureList(node)
    // Sections are the only wrappers whose lists are still "top level".
    layoutBlocks(node, topLevel && node.tagName === 'section')
    return node
  })
}

// ── Words on screen ───────────────────────────────────────────────────────

function splitQuoted(value: string): HastNode[] | null {
  QUOTED.lastIndex = 0
  const out: HastNode[] = []
  let last = 0
  for (let match = QUOTED.exec(value); match; match = QUOTED.exec(value)) {
    const words = match[1] ?? match[2] ?? match[3]
    // "  spaced  " is not a label, and an empty pair is not either.
    if (words.trim() !== words) continue
    if (match.index > last) out.push(text(value.slice(last, match.index)))
    out.push(element('span', { dataDoc: 'ui' }, [text(words)]))
    last = match.index + match[0].length
  }
  if (last === 0) return null
  if (last < value.length) out.push(text(value.slice(last)))
  return out
}

function markUiLabels(parent: HastElement | HastRoot): void {
  const next: HastNode[] = []
  for (const node of parent.children) {
    if (node.type === 'text') {
      next.push(...(splitQuoted((node as HastText).value) ?? [node]))
    } else {
      if (isElement(node) && !NO_UI_LABELS.has(node.tagName)) markUiLabels(node)
      next.push(node)
    }
  }
  parent.children = next
}

/** The rehype plugin: `rehypePlugins={[rehypeGuideLayout]}`. */
export function rehypeGuideLayout() {
  return (tree: HastRoot) => {
    layoutPage(tree)
    layoutBlocks(tree, true)
    markUiLabels(tree)
  }
}
