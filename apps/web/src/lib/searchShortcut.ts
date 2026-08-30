/**
 * Which palette a ⌘K-family keystroke opens.
 *
 * There are two window-level keydown listeners — `GlobalSearch` on ⌘K and the
 * admin palette on ⌘⇧K — and `preventDefault()` does not stop a sibling
 * listener on the same target. So the only thing keeping them apart was a case
 * comparison on a letter: one matched `'k'`, the other matched `'k'` or `'K'`.
 *
 * Letter case is not a signal of Shift. With **Caps Lock on**, Shift and Caps
 * cancel and `Shift+K` arrives as lowercase `'k'` — both matched, and both
 * palettes opened stacked on each other. `shiftKey` is the only field that
 * actually answers the question, so one function reads it and the call sites
 * ask which palette rather than deciding for themselves.
 */

export type SearchShortcut = 'global' | 'admin'

/** The fields of a `KeyboardEvent` this needs, so a test can build one. */
export interface SearchShortcutEvent {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether this keystroke is a search shortcut, and which one. Null for
 * everything else — a keystroke can never be both.
 */
export function matchSearchShortcut(event: SearchShortcutEvent): SearchShortcut | null {
  if (!(event.metaKey || event.ctrlKey)) return null
  // Ctrl+Alt is AltGr on a Windows layout, where it types a character rather
  // than invoking a shortcut.
  if (event.altKey) return null
  if (!isLetterK(event)) return null
  return event.shiftKey ? 'admin' : 'global'
}

function isLetterK({ key, code }: SearchShortcutEvent): boolean {
  // A non-Latin layout reports its own letter ('л' on Russian, 'ק' on Hebrew),
  // which would leave both palettes unreachable — hence the fall back to the
  // physical key. Only as a fallback, though: checking `code` first would give
  // a Dvorak typist's Ctrl+V, which sits on the physical K, the search palette.
  if (/^[a-z]$/i.test(key)) return key.toLowerCase() === 'k'
  return code === 'KeyK'
}
