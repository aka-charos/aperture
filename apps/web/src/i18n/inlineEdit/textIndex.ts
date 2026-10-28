/**
 * Which translation keys produced the text on screen — the pure half of the
 * inline text editor.
 *
 * While edit mode is on, an i18next post-processor hands every finished
 * string (interpolation already applied) to `record` with the key that
 * actually resolved (`foo_one`, not `foo`, for a plural). A click then looks
 * the clicked element's text up here. Nothing is written into the rendered
 * strings themselves: marking them with invisible characters would also mark
 * every translated string the app sends to the server, stores or compares
 * while edit mode is on.
 *
 * The cost of matching on text is that one text can come from several keys
 * ("Cancel" from a dozen dialogs); `lookup` returns all of them, most
 * recently rendered first, and the editor lets the admin pick.
 */

export interface RenderedString {
  key: string
  /** The finished text, interpolation applied. */
  value: string
  lng: string
  /** Order of the last render, for "most recent first". */
  seq: number
}

/** `<1>bold</1>` and `<strong>` style markup that `Trans` renders as elements,
 *  so the DOM's textContent never contains it. */
const MARKUP_RE = /<\/?(?:\d+|[a-zA-Z][a-zA-Z0-9]*)(?:\s[^<>]*)?\/?>/g
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const WHITESPACE_RE = /\s+/g

/** The form both sides are compared in: markup and zero-width characters
 *  removed, runs of whitespace (including the line breaks a layout adds)
 *  collapsed to one space, ends trimmed. Case is kept: CSS uppercasing does
 *  not change textContent. */
export function normalizeText(text: string): string {
  return text.replace(MARKUP_RE, '').replace(ZERO_WIDTH_RE, '').replace(WHITESPACE_RE, ' ').trim()
}

export class TextIndex {
  private byText = new Map<string, Map<string, RenderedString>>()
  private byKey = new Map<string, RenderedString>()
  private seq = 0

  /**
   * Record one render. A key that renders a new value (a counter, a relative
   * time) moves to the new text and leaves the old one, so a live string does
   * not grow the index with every tick. Returns true only when the key is new
   * since the last `clear` — the one change a listener needs to hear about.
   */
  record(key: string, value: string, lng: string): boolean {
    const text = normalizeText(value)
    if (!text) return false
    const previous = this.byKey.get(key)
    if (previous) {
      const previousText = normalizeText(previous.value)
      if (previousText !== text) {
        const keys = this.byText.get(previousText)
        keys?.delete(key)
        if (keys && keys.size === 0) this.byText.delete(previousText)
      }
    }
    const entry: RenderedString = { key, value, lng, seq: ++this.seq }
    let keys = this.byText.get(text)
    if (!keys) {
      keys = new Map()
      this.byText.set(text, keys)
    }
    keys.set(key, entry)
    this.byKey.set(key, entry)
    return !previous
  }

  /** Every key that rendered exactly this text, most recent first. */
  lookup(text: string): RenderedString[] {
    const keys = this.byText.get(normalizeText(text))
    if (!keys) return []
    return [...keys.values()].sort((a, b) => b.seq - a.seq)
  }

  /** Every key rendered since the last `clear`, in the order first seen. */
  rendered(): RenderedString[] {
    return [...this.byKey.values()].sort((a, b) => a.seq - b.seq)
  }

  get size(): number {
    return this.byKey.size
  }

  clear(): void {
    this.byText.clear()
    this.byKey.clear()
  }
}

/** The texts an element offers for matching, best evidence first: its own
 *  text nodes, then its whole text, then the attributes a translated string
 *  commonly lands in. Pure over a minimal shape so it can be tested without a
 *  DOM. */
export interface ElementTexts {
  ownText: string
  fullText: string
  attributes: (string | null)[]
}

/** Longer whole-element text is a container, not a label. */
export const MAX_FULL_TEXT = 400

export function candidateTexts({ ownText, fullText, attributes }: ElementTexts): string[] {
  const out: string[] = []
  const push = (value: string | null | undefined) => {
    if (!value) return
    const text = normalizeText(value)
    if (text && !out.includes(text)) out.push(text)
  }
  push(ownText)
  if (fullText.length <= MAX_FULL_TEXT) push(fullText)
  for (const attribute of attributes) push(attribute)
  return out
}

/** The first candidate text that maps to keys, or null. */
export function matchTexts(index: TextIndex, texts: string[]): { text: string; matches: RenderedString[] } | null {
  for (const text of texts) {
    const matches = index.lookup(text)
    if (matches.length > 0) return { text, matches }
  }
  return null
}

/**
 * The language shown beside English in the editor: the admin's last choice
 * when it is still offered, else the language the app is in (unless that is
 * English), else the first other language offered. Null when nothing but
 * English is offered.
 */
export function chooseCompareLocale(
  stored: string | null,
  uiLanguage: string,
  offered: string[]
): string | null {
  const others = offered.filter((code) => code !== 'en')
  if (stored && others.includes(stored)) return stored
  const ui = uiLanguage.split('-')[0]
  if (others.includes(ui)) return ui
  return others[0] ?? null
}
