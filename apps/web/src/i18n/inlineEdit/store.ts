/**
 * Inline text editing: the i18next side.
 *
 * Off, this costs nothing — the post-processor is not even in i18next's
 * options, so no translation call reaches it. On, every finished string is
 * recorded against the key that resolved it (see textIndex.ts), and every
 * `useTranslation` consumer is re-rendered once so what is already on screen
 * gets recorded too. That re-render rides on `REFRESH_EVENT`, which
 * config.ts adds to react-i18next's `bindI18n`.
 *
 * i18next's translator holds the SAME options object as the instance (it is
 * constructed with `this.options`) and reads `postProcess` on every call, so
 * switching it here takes effect at once without re-initialising anything.
 */
import i18n, { type PostProcessorModule } from 'i18next'
import { TextIndex } from './textIndex'

export const REFRESH_EVENT = 'inlineEditRefresh'
const PROCESSOR_NAME = 'inlineEdit'

const index = new TextIndex()
let enabled = false
let version = 0
let notifyPending = false
const listeners = new Set<() => void>()

/** Recording happens during render, so listeners are told afterwards: a
 *  state update in one component while another renders is a React error. */
function scheduleNotify(): void {
  if (notifyPending) return
  notifyPending = true
  setTimeout(() => {
    notifyPending = false
    version += 1
    for (const listener of listeners) listener()
  }, 0)
}

interface ResolvedDetails {
  res?: unknown
  usedKey?: string
  exactUsedKey?: string
  usedLng?: string
}

export const inlineEditPostProcessor: PostProcessorModule = {
  type: 'postProcessor',
  name: PROCESSOR_NAME,
  process(value, _key, options) {
    if (!enabled || typeof value !== 'string') return value
    const resolved = (options as { i18nResolved?: ResolvedDetails }).i18nResolved
    // No `res` means the key was missing and `value` is the key itself or a
    // caller's defaultValue: there is no stored string to edit.
    const key = resolved?.exactUsedKey || resolved?.usedKey
    // Listeners hear only about a key new to this screen: a string that
    // re-renders with a new value (a progress count) would otherwise wake the
    // editor's toolbar and list on every tick.
    if (key && resolved?.res !== undefined && index.record(key, value, resolved.usedLng || i18n.language)) {
      scheduleNotify()
    }
    return value
  },
}

type MutableOptions = { postProcess?: false | string | readonly string[]; postProcessPassResolved?: boolean }

export function isInlineEditEnabled(): boolean {
  return enabled
}

export function setInlineEditEnabled(on: boolean): void {
  if (on === enabled) return
  enabled = on
  const options = i18n.options as MutableOptions
  options.postProcess = on ? [PROCESSOR_NAME] : false
  // Hands the post-processor the key that actually resolved (`_one`, a
  // context suffix) rather than the one asked for.
  options.postProcessPassResolved = on
  refreshRenderedStrings()
}

/** Forget what was recorded and re-render every translated component so the
 *  index holds what is on screen now — on switching on, and after a
 *  navigation. */
export function refreshRenderedStrings(): void {
  index.clear()
  i18n.emit(REFRESH_EVENT)
  scheduleNotify()
}

/**
 * Show a saved string at once, without a reload. The index is NOT cleared:
 * the re-render moves the key to its new text, while anything this
 * re-render does not reach (a memoized subtree, a string computed once)
 * keeps its entry and stays clickable.
 */
export function applyLiveString(locale: string, key: string, value: string): void {
  i18n.addResource(locale, 'translation', key, value)
  i18n.emit(REFRESH_EVENT)
}

export function getTextIndex(): TextIndex {
  return index
}

export function subscribeInlineEdit(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getInlineEditVersion(): number {
  return version
}
