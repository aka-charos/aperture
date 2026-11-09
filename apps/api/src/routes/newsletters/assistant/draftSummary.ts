/**
 * The newsletter as the editor holds it, told to the model as an outline.
 *
 * Read through core's own document reader, so the model sees what the email
 * would contain (unknown nodes as their text, markup as plain text), and cut
 * to a budget: a long issue must not crowd out the conversation, so each
 * paragraph is clipped and the whole outline stops at `OUTLINE_MAX_CHARS`
 * with a note saying so.
 *
 * `outlineDraft` is pure; `summarizeDraft` adds the title names.
 */
import { loadTitleFacts, readNewsletterDocument, titleKey, titleRefsIn, type NewsletterPart } from '@aperture/core'

/** What the editor sends with each turn: the unsaved state, not the stored row. */
export interface NewsletterDraftContext {
  subject: string
  preheader: string
  content: unknown
  groupIds: string[]
}

export const OUTLINE_BLOCK_CHARS = 500
export const OUTLINE_MAX_CHARS = 8000

type Runs = { text: string }[]

const plain = (runs: Runs) => runs.map((run) => run.text).join('').replace(/\s+/g, ' ').trim()

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

export interface DraftOutline {
  subject: string
  preheader: string
  empty: boolean
  titleCount: number
  outline: string[]
  truncated: boolean
}

/** The draft's blocks as numbered lines; title cards by name. */
export function outlineDraft(
  draft: Pick<NewsletterDraftContext, 'subject' | 'preheader'>,
  parts: readonly NewsletterPart[],
  titleName: (part: Extract<NewsletterPart, { type: 'titleRef' }>) => string
): DraftOutline {
  const outline: string[] = []
  let used = 0
  let truncated = false
  let titleCount = 0
  for (const part of parts) {
    let line: string
    switch (part.type) {
      case 'heading':
        line = `${part.level === 2 ? '## ' : '### '}${clip(plain(part.runs), OUTLINE_BLOCK_CHARS)}`
        break
      case 'paragraph':
        line = clip(plain(part.runs), OUTLINE_BLOCK_CHARS)
        break
      case 'quote':
        line = `> ${clip(plain(part.runs), OUTLINE_BLOCK_CHARS)}`
        break
      case 'list':
        line = part.items.map((item, i) => `${part.ordered ? `${i + 1}.` : '-'} ${clip(plain(item), 200)}`).join('\n')
        break
      case 'rule':
        line = '---'
        break
      case 'titleRef':
        titleCount += 1
        line = `[Title card: ${titleName(part)} — shows ${part.fields.join(', ') || 'nothing'}]`
        break
      default:
        continue
    }
    if (used + line.length > OUTLINE_MAX_CHARS) {
      truncated = true
      // Still count the cards past the cut, so the model knows the issue's size.
      continue
    }
    used += line.length
    outline.push(line)
  }
  return {
    subject: draft.subject.trim(),
    preheader: draft.preheader.trim(),
    empty: parts.length === 0,
    titleCount,
    outline,
    truncated,
  }
}

export async function summarizeDraft(draft: NewsletterDraftContext): Promise<DraftOutline & { note?: string }> {
  const parts = readNewsletterDocument(draft.content)
  const facts = await loadTitleFacts(titleRefsIn(parts))
  const result = outlineDraft(draft, parts, (part) => {
    const fact = facts.get(titleKey(part))
    return fact ? `${fact.title}${fact.year ? ` (${fact.year})` : ''}, ${part.mediaType}, id ${part.id}` : 'a title no longer in the library'
  })
  return {
    ...result,
    ...(result.empty ? { note: 'The newsletter body is empty.' } : {}),
    ...(result.truncated ? { note: 'The outline was cut short; later blocks are not shown.' } : {}),
  }
}
