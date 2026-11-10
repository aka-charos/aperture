/**
 * What the newsletter writing assistant's tool results mean to the panel. Pure.
 *
 * The chat's tools do not agree on one card shape (some say `name`, some
 * `title`; some `image`, some `posterUrl`), so this reads both, and returns
 * nothing for a result it does not recognise rather than guessing. Shapes here
 * mirror the API by hand (routes/newsletters/assistant/tools.ts and the chat's
 * tools); the bundle never imports the server.
 */
import type { TitleCardAttrs } from '../fields'

/** A library title a result offers, ready to become a card. */
export interface TitleChoice {
  id: string
  mediaType: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  subtitle: string | null
}

/** An editor node, as TipTap's JSON holds it (core newsletter/draft.ts `EditorNode`). */
export interface EditorNode {
  type: string
  attrs?: Record<string, unknown>
  content?: EditorNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface Proposal {
  subject: string | null
  preheader: string | null
  content: EditorNode[]
  titles: { id: string; mediaType: 'movie' | 'series'; title: string }[]
  /** How many blocks the server could not use. */
  droppedCount: number
  problem: string | null
  /** Why inserting it beside what the newsletter held when it was proposed would not save. */
  insertProblem: string | null
}

export interface ReachRow {
  id: string
  title: string
  canOpen: number
  of: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function readChoice(raw: unknown): TitleChoice | null {
  if (!isRecord(raw)) return null
  // An episode card stands for an episode, not a title a newsletter card can show.
  if (raw.episode != null) return null
  const mediaType = raw.type === 'movie' || raw.type === 'series' ? raw.type : null
  const id = str(raw.id)
  const title = str(raw.name) ?? str(raw.title)
  if (!mediaType || !id || !title) return null
  const year = typeof raw.year === 'number' && Number.isFinite(raw.year) ? raw.year : null
  return {
    id,
    mediaType,
    title,
    year,
    posterUrl: str(raw.image) ?? str(raw.posterUrl),
    subtitle: str(raw.subtitle) ?? str(raw.value),
  }
}

/** Every title a tool result lists, each once, in order: `{ items }` and `{ carousels: [{ items }] }`. */
export function titleChoicesFrom(output: unknown): TitleChoice[] {
  if (!isRecord(output)) return []
  const lists: unknown[][] = []
  if (Array.isArray(output.items)) lists.push(output.items)
  if (Array.isArray(output.carousels)) {
    for (const carousel of output.carousels) {
      if (isRecord(carousel) && Array.isArray(carousel.items)) lists.push(carousel.items)
    }
  }
  const seen = new Set<string>()
  const choices: TitleChoice[] = []
  for (const raw of lists.flat()) {
    const choice = readChoice(raw)
    if (!choice) continue
    const key = `${choice.mediaType}:${choice.id}`
    if (seen.has(key)) continue
    seen.add(key)
    choices.push(choice)
  }
  return choices
}

export function proposalFrom(output: unknown): Proposal | null {
  if (!isRecord(output) || !isRecord(output.proposal)) return null
  const p = output.proposal
  const content = Array.isArray(p.content) ? (p.content.filter(isRecord) as unknown as EditorNode[]) : []
  const titles = Array.isArray(p.titles)
    ? p.titles.filter(isRecord).flatMap((t) => {
        const id = str(t.id)
        const title = str(t.title)
        const mediaType = t.mediaType === 'series' ? 'series' : t.mediaType === 'movie' ? 'movie' : null
        return id && title && mediaType ? [{ id, title, mediaType } as const] : []
      })
    : []
  return {
    subject: str(p.subject),
    preheader: str(p.preheader),
    content,
    titles,
    droppedCount: Array.isArray(p.dropped) ? p.dropped.length : 0,
    problem: str(p.problem),
    insertProblem: str(p.insertProblem),
  }
}

export function reachFrom(output: unknown): { rows: ReachRow[]; note: string | null } | null {
  if (!isRecord(output)) return null
  if (!Array.isArray(output.titles) && !str(output.note)) return null
  const rows = Array.isArray(output.titles)
    ? output.titles.filter(isRecord).flatMap((t) => {
        const id = str(t.id)
        const title = str(t.title)
        if (!id || !title || typeof t.canOpen !== 'number' || typeof t.of !== 'number') return []
        return [{ id, title, canOpen: t.canOpen, of: t.of }]
      })
    : []
  return { rows, note: str(output.note) }
}

/** A tool's own failure (`{ error }` from the server's backstop). */
export function toolErrorFrom(output: unknown): string | null {
  return isRecord(output) ? str(output.error) : null
}

/** The editor node a chosen title becomes: the same attributes the title picker inserts. */
export function titleCardNode(choice: TitleChoice, fields: readonly string[]): EditorNode {
  const attrs: TitleCardAttrs = {
    mediaType: choice.mediaType,
    id: choice.id,
    title: choice.title,
    year: choice.year,
    posterUrl: choice.posterUrl,
    fields: [...fields],
    analysisParts: [],
  }
  return { type: 'titleCard', attrs: attrs as unknown as Record<string, unknown> }
}

/** Title-card ids an editor document holds, so the panel can show what is already in. */
export function titleIdsIn(doc: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (node: unknown) => {
    if (!isRecord(node)) return
    if (node.type === 'titleCard' && isRecord(node.attrs) && typeof node.attrs.id === 'string') {
      ids.add(`${node.attrs.mediaType === 'series' ? 'series' : 'movie'}:${node.attrs.id}`)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc)
  return ids
}

/** Plain text of a node list, for a proposal's preview line count. */
export function nodeText(nodes: readonly EditorNode[]): string {
  return nodes
    .map((node) => (node.text ?? '') + (node.content ? nodeText(node.content) : ''))
    .join('')
}

/** What the newsletter is, as the assistant is told it on each turn: the editor's unsaved state. */
export interface AssistantDraft {
  subject: string
  preheader: string
  content: Record<string, unknown>
  groupIds: string[]
}

/** What the panel may do to the newsletter: the editor page owns all of it. */
export interface NewsletterAssistantHost {
  editable: boolean
  getDraft: () => AssistantDraft
  /** `movie:<id>` / `series:<id>` keys of the title cards in the newsletter now. */
  titlesInNewsletter: ReadonlySet<string>
  /** The most title cards a newsletter may hold (decided by the server). */
  maxTitles: number
  defaultFields: readonly string[]
  insertNodes: (nodes: EditorNode[]) => void
  replaceContent: (nodes: EditorNode[]) => void
  setSubject: (value: string) => void
  setPreheader: (value: string) => void
}

/** How many of a proposal's titles are not in the newsletter yet, so inserting adds a card for each. */
export function newTitleCount(proposal: Pick<Proposal, 'titles'>, inNewsletter: ReadonlySet<string>): number {
  return proposal.titles.filter((title) => !inNewsletter.has(`${title.mediaType}:${title.id}`)).length
}
