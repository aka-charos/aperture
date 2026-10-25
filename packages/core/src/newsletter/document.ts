/**
 * A newsletter's editor document, read into email blocks. Pure.
 *
 * The admin writes in a WYSIWYG editor (TipTap, in the web bundle) whose
 * document is JSON. That JSON is stored as it is and NEVER rendered as HTML:
 * this module walks it and keeps only the node and mark types it knows,
 * reducing each to plain text plus styling flags (`EmailRun`), which the email
 * renderer then escapes. So whatever reaches the stored document — a pasted
 * page, a hand-edited request, an editor extension added later — can carry no
 * markup, script or tracking image into anyone's inbox. An unknown node keeps
 * its text and loses its shape; an unknown mark is dropped.
 *
 * Library titles are their own node (`titleCard`) holding a reference and the
 * facts the admin chose to show; this module only reads the reference. What a
 * title says is looked up when the email is built, per recipient language and
 * per recipient scope (newsletter/build.ts), so a card never carries text that
 * was true when it was inserted and is stale by the time it is sent.
 */
import type { EmailBlock, EmailRun } from '../email/template.js'

/** What a title card can show, in the order a card shows it. */
export const TITLE_FIELDS = [
  'poster',
  'year',
  'runtime',
  'genres',
  'rating',
  'director',
  'cast',
  'network',
  'languages',
  'countries',
  'plot',
  'fullPlot',
  'analysis',
  'link',
] as const

export type TitleField = (typeof TITLE_FIELDS)[number]

/** What a freshly inserted card shows until the admin changes it. */
export const DEFAULT_TITLE_FIELDS: readonly TitleField[] = ['poster', 'year', 'genres', 'plot', 'link']

export function isTitleField(value: unknown): value is TitleField {
  return typeof value === 'string' && (TITLE_FIELDS as readonly string[]).includes(value)
}

export interface TitleRef {
  mediaType: 'movie' | 'series'
  id: string
}

/** A card waiting for its title's facts. */
export interface TitlePart extends TitleRef {
  type: 'titleRef'
  fields: TitleField[]
}

export type NewsletterPart = Exclude<EmailBlock, { type: 'title' }> | TitlePart

/** Bounds on a stored document, so one request cannot make a megabyte email. */
export const NEWSLETTER_MAX_PARTS = 400
export const NEWSLETTER_MAX_TITLES = 40
export const NEWSLETTER_MAX_TEXT_CHARS = 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Node = { type?: unknown; attrs?: unknown; content?: unknown; text?: unknown; marks?: unknown }

function asNode(value: unknown): Node | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null
}

function children(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.map(asNode).filter((n): n is Node => n !== null) : []
}

function attrs(node: Node): Record<string, unknown> {
  return node.attrs && typeof node.attrs === 'object' ? (node.attrs as Record<string, unknown>) : {}
}

/** The inline content of a text block, as runs. A hard break is a line break. */
function readRuns(node: Node): EmailRun[] {
  const runs: EmailRun[] = []
  for (const child of children(node)) {
    if (child.type === 'hardBreak') {
      runs.push({ text: '\n' })
      continue
    }
    if (child.type === 'text' && typeof child.text === 'string') {
      const run: EmailRun = { text: child.text }
      for (const mark of Array.isArray(child.marks) ? child.marks.map(asNode) : []) {
        if (!mark) continue
        if (mark.type === 'bold') run.bold = true
        else if (mark.type === 'italic') run.italic = true
        else if (mark.type === 'underline') run.underline = true
        else if (mark.type === 'strike') run.strike = true
        else if (mark.type === 'link' && typeof attrs(mark).href === 'string') run.href = attrs(mark).href as string
      }
      runs.push(run)
      continue
    }
    // Anything else inline: its text, unstyled.
    runs.push(...readRuns(child))
  }
  return runs
}

function hasText(runs: readonly EmailRun[]): boolean {
  return runs.some((run) => run.text.trim() !== '')
}

/** Several text blocks as one run list, a line break between them. */
function joinBlocks(nodes: readonly Node[]): EmailRun[] {
  const runs: EmailRun[] = []
  for (const node of nodes) {
    const next = readRuns(node)
    if (!hasText(next)) continue
    if (runs.length > 0) runs.push({ text: '\n' })
    runs.push(...next)
  }
  return runs
}

/** A list's items, nested lists flattened into the same list after their parent item. */
function readListItems(list: Node): EmailRun[][] {
  const items: EmailRun[][] = []
  for (const item of children(list)) {
    const nested = children(item).filter((c) => c.type === 'bulletList' || c.type === 'orderedList')
    const own = joinBlocks(children(item).filter((c) => !nested.includes(c)))
    if (hasText(own)) items.push(own)
    for (const sub of nested) items.push(...readListItems(sub))
  }
  return items
}

function readTitle(node: Node): TitlePart | null {
  const a = attrs(node)
  const mediaType = a.mediaType === 'series' ? 'series' : a.mediaType === 'movie' ? 'movie' : null
  const id = typeof a.id === 'string' && UUID.test(a.id) ? a.id : null
  if (!mediaType || !id) return null
  const requested = Array.isArray(a.fields) ? a.fields.filter(isTitleField) : [...DEFAULT_TITLE_FIELDS]
  // Kept in TITLE_FIELDS order whatever order the editor stored them in.
  const fields = TITLE_FIELDS.filter((field) => requested.includes(field))
  return { type: 'titleRef', mediaType, id, fields }
}

function readBlock(node: Node, out: NewsletterPart[]): void {
  switch (node.type) {
    case 'paragraph': {
      const runs = readRuns(node)
      if (hasText(runs)) out.push({ type: 'paragraph', runs })
      return
    }
    case 'heading': {
      const runs = readRuns(node)
      const level = Number(attrs(node).level)
      if (hasText(runs)) out.push({ type: 'heading', level: level >= 3 ? 3 : 2, runs })
      return
    }
    case 'bulletList':
    case 'orderedList': {
      const items = readListItems(node)
      if (items.length > 0) out.push({ type: 'list', ordered: node.type === 'orderedList', items })
      return
    }
    case 'blockquote': {
      const runs = joinBlocks(children(node))
      if (hasText(runs)) out.push({ type: 'quote', runs })
      return
    }
    case 'horizontalRule':
      out.push({ type: 'rule' })
      return
    case 'titleCard': {
      const title = readTitle(node)
      if (title) out.push(title)
      return
    }
    default: {
      // Unknown block: walk into it, so its text survives without its shape.
      const nested = children(node)
      if (nested.some((child) => child.type === 'text' || child.type === 'hardBreak')) {
        const runs = readRuns(node)
        if (hasText(runs)) out.push({ type: 'paragraph', runs })
      } else {
        for (const child of nested) readBlock(child, out)
      }
    }
  }
}

/** The document's parts, in order. Anything that is not a document reads as empty. */
export function readNewsletterDocument(doc: unknown): NewsletterPart[] {
  const root = asNode(doc)
  if (!root) return []
  const out: NewsletterPart[] = []
  for (const child of children(root)) readBlock(child, out)
  return out
}

/** Why a document cannot be saved, or null. Checked at save and again at send. */
export function newsletterDocumentProblem(doc: unknown): string | null {
  const root = asNode(doc)
  if (!root || root.type !== 'doc') return 'The newsletter body is not an editor document'
  const parts = readNewsletterDocument(doc)
  if (parts.length > NEWSLETTER_MAX_PARTS) return `The newsletter is longer than ${NEWSLETTER_MAX_PARTS} blocks`
  if (titleRefsIn(parts).length > NEWSLETTER_MAX_TITLES) {
    return `A newsletter can show at most ${NEWSLETTER_MAX_TITLES} titles`
  }
  if (documentTextLength(parts) > NEWSLETTER_MAX_TEXT_CHARS) {
    return `The newsletter text is longer than ${NEWSLETTER_MAX_TEXT_CHARS} characters`
  }
  return null
}

function documentTextLength(parts: readonly NewsletterPart[]): number {
  const runsLength = (runs: readonly EmailRun[]) => runs.reduce((sum, run) => sum + run.text.length, 0)
  return parts.reduce((sum, part) => {
    if (part.type === 'paragraph' || part.type === 'heading' || part.type === 'quote') return sum + runsLength(part.runs)
    if (part.type === 'list') return sum + part.items.reduce((s, item) => s + runsLength(item), 0)
    return sum
  }, 0)
}

/** Each distinct title the document shows, first appearance first. */
export function titleRefsIn(parts: readonly NewsletterPart[]): TitleRef[] {
  const seen = new Set<string>()
  const refs: TitleRef[] = []
  for (const part of parts) {
    if (part.type !== 'titleRef') continue
    const key = titleKey(part)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ mediaType: part.mediaType, id: part.id })
  }
  return refs
}

export function titleKey(ref: TitleRef): string {
  return `${ref.mediaType}:${ref.id}`
}
