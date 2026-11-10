/**
 * The newsletter writing assistant's proposals, turned into editor content. Pure.
 *
 * The assistant never writes the editor's JSON itself: a model asked for
 * TipTap JSON invents node types, drops required attributes and nests marks
 * wrongly, and every mistake would reach the stored document. It hands over
 * plain blocks instead (one flat object shape, so the tool's input schema
 * carries no union), and this module builds the nodes the editor already
 * knows, the same ones the toolbar and the title picker insert.
 *
 * What a block may say is narrower than what the editor allows:
 * - inline styling is `**bold**`, `*italic*` (or `_italic_`) and
 *   `[label](https://…)`; anything else stays literal text, and a link that is
 *   not http(s) keeps its label and loses the link, as the email renderer would;
 * - a title card names a library title by id and type. A title the caller could
 *   not find (an id the model made up, or one outside the admin's scope) is
 *   dropped and reported, never inserted as a card that would show nothing;
 * - card fields and analysis parts are kept only when they are real, in the
 *   order a card shows them; none asked for means the editor's defaults.
 *
 * The result is checked with the same reader the save route uses
 * (`newsletterDocumentProblem`), so a proposal the editor would refuse to save
 * is refused here, where the model can be told why.
 */
import {
  DEFAULT_TITLE_FIELDS,
  NEWSLETTER_MAX_TITLES,
  analysisPartsFor,
  currentAnalysisPart,
  isTitleField,
  newsletterDocumentProblem,
  titleKey,
  TITLE_FIELDS,
  type TitleRef,
} from './document.js'
import type { AnalysisQuestionId } from '../analysis/prompt.js'

export const DRAFT_BLOCK_KINDS = ['heading', 'subheading', 'paragraph', 'bullets', 'numbered', 'quote', 'title', 'rule'] as const
export type DraftBlockKind = (typeof DRAFT_BLOCK_KINDS)[number]

/** At most this many blocks in one proposal: a whole issue fits, a runaway list does not. */
export const DRAFT_MAX_BLOCKS = 120
/** Longest text one block may carry before it is cut (at a word). */
export const DRAFT_MAX_BLOCK_CHARS = 4000

/** One block as the model sends it. Every field but `kind` is optional; each kind reads its own. */
export interface DraftBlockInput {
  kind: string
  text?: string | null
  items?: (string | null)[] | null
  titleId?: string | null
  mediaType?: string | null
  fields?: (string | null)[] | null
  analysisParts?: (string | null)[] | null
}

/** What the editor needs to draw a card before the email reads it fresh. */
export interface DraftTitleInfo {
  title: string
  year: number | null
  posterUrl: string | null
}

/** An editor node, as TipTap's JSON holds it. */
export interface EditorNode {
  type: string
  attrs?: Record<string, unknown>
  content?: EditorNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export type DraftDropReason = 'unknownKind' | 'empty' | 'unknownTitle' | 'tooManyTitles' | 'tooManyBlocks'

export interface DraftDrop {
  index: number
  reason: DraftDropReason
  /** The title id or kind that was dropped, so the model can be told which. */
  detail?: string
}

export interface DraftResult {
  /** The nodes to insert, in order. Empty when nothing survived. */
  content: EditorNode[]
  dropped: DraftDrop[]
  /** Each distinct title the proposal carries, first appearance first (a title shown twice is one title, as the save counts it). */
  titles: (TitleRef & { title: string })[]
  /** Set when the editor would refuse to save the result; nothing should be inserted then. */
  problem: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cut long text at a word boundary, never mid-word, with an ellipsis. */
function clip(text: string): string {
  if (text.length <= DRAFT_MAX_BLOCK_CHARS) return text
  const cut = text.slice(0, DRAFT_MAX_BLOCK_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${(space > DRAFT_MAX_BLOCK_CHARS * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** http(s) only; anything else is not a link. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

type Mark = NonNullable<EditorNode['marks']>[number]

function textNode(text: string, marks: Mark[]): EditorNode {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
}

/**
 * One line of model text as styled text nodes. A marker without its closing
 * partner is literal text; nested styling is one level deep (bold inside a
 * link label, italic inside bold) because that is all a newsletter needs.
 */
export function inlineNodes(line: string, outer: Mark[] = []): EditorNode[] {
  const nodes: EditorNode[] = []
  // Link, bold, italic (* or _), in the order they are tried at each position.
  // A link address may hold one level of brackets (`Heat_(1995_film)`), as
  // Wikipedia titles do; the first `)` must not end it.
  const pattern = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w])/g
  let last = 0
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) nodes.push(textNode(line.slice(last, at), outer))
    const [, label, href, bold, italic, underscored] = match
    if (label != null) {
      const link = href != null ? safeHref(href) : null
      nodes.push(...inlineNodes(label, link ? [...outer, { type: 'link', attrs: { href: link } }] : outer))
    } else if (bold != null) {
      nodes.push(...inlineNodes(bold, [...outer, { type: 'bold' }]))
    } else {
      nodes.push(textNode(italic ?? underscored ?? '', [...outer, { type: 'italic' }]))
    }
    last = at + match[0].length
  }
  if (last < line.length) nodes.push(textNode(line.slice(last), outer))
  return nodes.filter((node) => node.text !== '')
}

/** A text block's content: lines joined by hard breaks. */
function blockContent(text: string): EditorNode[] {
  const content: EditorNode[] = []
  text.split('\n').forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    content.push(...inlineNodes(line))
  })
  // A trailing or leading break carries nothing.
  while (content[0]?.type === 'hardBreak') content.shift()
  while (content.at(-1)?.type === 'hardBreak') content.pop()
  return content
}

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? clip(value.replace(/\r\n?/g, '\n').trim()) : ''
}

function cleanStrings(values: (string | null)[] | null | undefined): string[] {
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []
}

/** Card fields in card order; nothing (or nothing real) asked for means the defaults. */
export function draftCardFields(requested: readonly string[]): string[] {
  const known = requested.filter(isTitleField)
  if (known.length === 0) return [...DEFAULT_TITLE_FIELDS]
  return TITLE_FIELDS.filter((field) => known.includes(field))
}

/** Analysis parts this media type has, in prompt order; none when the card does not show the analysis. */
export function draftAnalysisParts(
  mediaType: 'movie' | 'series',
  fields: readonly string[],
  requested: readonly string[]
): string[] {
  if (!fields.includes('analysis')) return []
  const wanted = requested.map((part) => currentAnalysisPart(part as AnalysisQuestionId))
  return analysisPartsFor(mediaType).filter((part) => wanted.includes(part))
}

/** The title references a proposal names, valid ids only, each once, in order. */
export function draftTitleRefs(blocks: readonly DraftBlockInput[]): TitleRef[] {
  const refs: TitleRef[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'title') continue
    const mediaType = block.mediaType === 'series' ? 'series' : block.mediaType === 'movie' ? 'movie' : null
    const id = typeof block.titleId === 'string' ? block.titleId.trim() : ''
    if (!mediaType || !UUID.test(id)) continue
    const ref = { mediaType, id: id.toLowerCase() } as TitleRef
    if (seen.has(titleKey(ref))) continue
    seen.add(titleKey(ref))
    refs.push(ref)
  }
  return refs
}

/**
 * Build editor nodes from the model's blocks. `titles` holds the titles the
 * caller found (in the admin's scope), keyed by `titleKey`; a block naming any
 * other title is dropped.
 */
export function buildDraftContent(
  blocks: readonly DraftBlockInput[],
  titles: ReadonlyMap<string, DraftTitleInfo>
): DraftResult {
  const content: EditorNode[] = []
  const dropped: DraftDrop[] = []
  const placed: DraftResult['titles'] = []
  const placedKeys = new Set<string>()

  blocks.forEach((block, index) => {
    if (index >= DRAFT_MAX_BLOCKS) {
      dropped.push({ index, reason: 'tooManyBlocks' })
      return
    }
    const kind = block.kind as DraftBlockKind
    switch (kind) {
      case 'heading':
      case 'subheading':
      case 'paragraph':
      case 'quote': {
        const text = cleanText(block.text)
        if (!text) {
          dropped.push({ index, reason: 'empty', detail: kind })
          return
        }
        if (kind === 'quote') {
          content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: blockContent(text) }] })
        } else if (kind === 'paragraph') {
          // A blank line is a new paragraph, as it reads.
          for (const paragraph of text.split(/\n\s*\n/)) {
            const inner = blockContent(paragraph.trim())
            if (inner.length > 0) content.push({ type: 'paragraph', content: inner })
          }
        } else {
          // A heading is one line.
          content.push({
            type: 'heading',
            attrs: { level: kind === 'heading' ? 2 : 3 },
            content: inlineNodes(text.replace(/\s*\n\s*/g, ' ')),
          })
        }
        return
      }
      case 'bullets':
      case 'numbered': {
        const items = cleanStrings(block.items).map((item) => cleanText(item)).filter(Boolean)
        if (items.length === 0) {
          dropped.push({ index, reason: 'empty', detail: kind })
          return
        }
        content.push({
          type: kind === 'bullets' ? 'bulletList' : 'orderedList',
          ...(kind === 'numbered' ? { attrs: { start: 1 } } : {}),
          content: items.map((item) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: blockContent(item) }],
          })),
        })
        return
      }
      case 'rule':
        content.push({ type: 'horizontalRule' })
        return
      case 'title': {
        const [ref] = draftTitleRefs([block])
        const info = ref ? titles.get(titleKey(ref)) : undefined
        if (!ref || !info) {
          dropped.push({ index, reason: 'unknownTitle', detail: String(block.titleId ?? '') })
          return
        }
        // A repeated card is the same title: `newsletterDocumentProblem` counts
        // distinct titles, so only a new one can go past the limit.
        const key = titleKey(ref)
        const repeat = placedKeys.has(key)
        if (!repeat && placed.length >= NEWSLETTER_MAX_TITLES) {
          dropped.push({ index, reason: 'tooManyTitles', detail: info.title })
          return
        }
        const fields = draftCardFields(cleanStrings(block.fields))
        content.push({
          type: 'titleCard',
          attrs: {
            mediaType: ref.mediaType,
            id: ref.id,
            title: info.title,
            year: info.year,
            posterUrl: info.posterUrl,
            fields,
            analysisParts: draftAnalysisParts(ref.mediaType, fields, cleanStrings(block.analysisParts)),
          },
        })
        if (!repeat) {
          placedKeys.add(key)
          placed.push({ ...ref, title: info.title })
        }
        return
      }
      default:
        dropped.push({ index, reason: 'unknownKind', detail: String(block.kind) })
    }
  })

  const problem = content.length > 0 ? newsletterDocumentProblem({ type: 'doc', content }) : null
  return { content: problem ? [] : content, dropped, titles: placed, problem }
}

/**
 * What the model reads back after proposing: counts and the titles placed, not
 * the nodes (they are for the editor, and would be resent every turn).
 */
export function describeDraftForModel(
  result: DraftResult,
  subject: string | null,
  insertRefusal: string | null = null
): string {
  if (result.problem) return `The draft was refused and nothing was shown: ${result.problem}`
  if (result.content.length === 0) {
    return 'Nothing in the draft could be shown to the admin. Check the blocks: every title needs an id and type from a search result.'
  }
  const counts = new Map<string, number>()
  for (const node of result.content) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  const parts = [...counts].map(([type, n]) => `${n} ${type}`).join(', ')
  const lines = [`Draft shown to the admin as a preview with Insert buttons (${parts}). It is NOT in the newsletter until they insert it.`]
  if (subject) lines.push(`Suggested subject: ${subject}`)
  if (insertRefusal) {
    lines.push(
      `It cannot be inserted next to what the newsletter already holds (${insertRefusal}); only Replace is offered. Say so, or propose something shorter.`
    )
  }
  if (result.titles.length > 0) lines.push(`Title cards: ${result.titles.map((t) => t.title).join('; ')}`)
  const unknown = result.dropped.filter((d) => d.reason === 'unknownTitle').map((d) => d.detail)
  if (unknown.length > 0) {
    lines.push(
      `Dropped title blocks whose id was not found in the library: ${unknown.join(', ')}. Use ids exactly as search results give them.`
    )
  }
  const other = result.dropped.filter((d) => d.reason !== 'unknownTitle')
  if (other.length > 0) lines.push(`Also dropped: ${other.map((d) => `block ${d.index + 1} (${d.reason})`).join(', ')}.`)
  return lines.join('\n')
}

/**
 * Why inserting `content` into the newsletter as it stands would make a
 * document the editor cannot save (too many titles, blocks or characters), or
 * null. The proposal alone may be fine, so Replace can still be offered.
 */
export function insertProblem(currentDoc: unknown, content: readonly EditorNode[]): string | null {
  if (content.length === 0) return null
  const current =
    currentDoc && typeof currentDoc === 'object' && Array.isArray((currentDoc as { content?: unknown }).content)
      ? ((currentDoc as { content: unknown[] }).content)
      : []
  return newsletterDocumentProblem({ type: 'doc', content: [...current, ...content] })
}
