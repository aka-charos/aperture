/**
 * Where a synopsis has to stop so it ends on "… More ›" within a given number
 * of lines.
 *
 * CSS `line-clamp` can only end on a bare ellipsis, and a link placed after a
 * clamped block lands on a line of its own. So the text is cut here instead:
 * the longest word-boundary prefix that, followed by the suffix, still fits.
 *
 * Measured in an off-screen copy carrying the synopsis's own font and width,
 * never by rewriting the rendered element, which React owns.
 */

/** The copy's styles are read from the element it stands in for. */
const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'wordSpacing',
  'textTransform',
  'direction',
] as const

/**
 * The character count to show, or null when the whole text fits without the
 * suffix. 0 means not even one word fits beside it.
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
  probe.style.insetInlineStart = '-10000px'
  probe.style.top = '0'
  probe.style.width = `${width}px`
  probe.style.whiteSpace = 'normal'
  probe.style.overflowWrap = 'break-word'
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
    // Longest prefix that fits, by halving; the text is a few hundred
    // characters, so this is about ten layouts.
    let low = 0
    let high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (fits(mid)) low = mid
      else high = mid - 1
    }
    // Back to the last word boundary, so no word is cut in half.
    const space = text.lastIndexOf(' ', low)
    return space > 0 && low < text.length ? space : low
  } finally {
    probe.remove()
  }
}
