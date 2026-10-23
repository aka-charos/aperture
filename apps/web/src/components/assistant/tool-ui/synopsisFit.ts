/**
 * Where a synopsis has to stop so it ends on "… More ›" within a given number
 * of lines.
 *
 * CSS `line-clamp` can only end on a bare ellipsis, and a link placed after a
 * clamped block lands on a line of its own. So the text is cut here instead:
 * the longest word-boundary prefix that, followed by the suffix, still fits.
 *
 * Measured in an off-screen copy carrying the synopsis's own font and width,
 * never by rewriting the rendered element, which React owns. The card keeps a
 * height cap as well, so a copy that measures a hair differently from the real
 * text costs a clipped line rather than a synopsis running past the poster.
 */

/** Everything about the text that can move where a line breaks. */
const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontVariant',
  'fontKerning',
  'fontFeatureSettings',
  'fontVariationSettings',
  'letterSpacing',
  'lineHeight',
  'wordSpacing',
  'wordBreak',
  'overflowWrap',
  'hyphens',
  'textTransform',
  'direction',
] as const

/** Not even the suffix fits in the lines allowed: show no synopsis. */
export const NOTHING_FITS = -1

/**
 * The character count to show before the suffix, null when the whole text fits
 * without one, or `NOTHING_FITS`. 0 means the suffix fits but no word beside it.
 *
 * `suffix` is the suffix as it renders (ellipsis, space, label), and
 * `suffixWeight` the weight it renders at, since a bolder label is wider.
 */
export function fitSynopsis(
  text: string,
  element: HTMLElement,
  maxLines: number,
  suffix: string,
  suffixWeight: string
): number | null {
  const style = getComputedStyle(element)
  const lineHeight = Number.parseFloat(style.lineHeight)
  const width = element.clientWidth
  if (!(lineHeight > 0) || width <= 0 || maxLines <= 0) return null
  const limit = maxLines * lineHeight + 1

  const probe = document.createElement('div')
  for (const key of COPIED_STYLES) probe.style[key] = style[key]
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.left = '-10000px'
  probe.style.top = '0'
  probe.style.width = `${width}px`
  probe.style.whiteSpace = 'normal'
  const body = document.createTextNode('')
  const tail = document.createElement('span')
  tail.style.fontWeight = suffixWeight
  tail.textContent = suffix
  probe.append(body, tail)
  document.body.appendChild(probe)

  try {
    // The whole text, with no suffix at all.
    tail.style.display = 'none'
    body.data = text
    if (probe.scrollHeight <= limit) return null
    tail.style.display = ''

    const fits = (length: number) => {
      body.data = text.slice(0, length).trimEnd()
      return probe.scrollHeight <= limit
    }
    if (!fits(0)) return NOTHING_FITS
    // Longest prefix that fits, by halving; the text is a few hundred
    // characters, so this is about ten layouts. It is always shorter than the
    // whole text, which was just shown not to fit.
    let low = 0
    let high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (fits(mid)) low = mid
      else high = mid - 1
    }
    // Back to the last word boundary, so no word is cut in half.
    const space = text.lastIndexOf(' ', low)
    return space > 0 ? space : low
  } finally {
    probe.remove()
  }
}
