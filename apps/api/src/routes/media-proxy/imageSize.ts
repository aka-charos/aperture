/**
 * How large an image the proxy asks the media server for.
 *
 * Library rows store image URLs with no size, and the proxy forwarded them as
 * they were, so Emby answered with the ORIGINAL file: measured on one title
 * page, posters of 2.2, 2.5 and 3.2 MB each, every one drawn into a box a few
 * hundred pixels wide. Asking for a width makes the server resize (and cache
 * the resized copy) before anything crosses the network.
 *
 * Pure so the rule is pinned by a test, and so a caller that DOES name a size
 * is never overridden: any sizing parameter already on the request wins.
 */

/** Widths per image kind, at roughly twice the largest box each is drawn in. */
export const DEFAULT_IMAGE_WIDTHS = {
  /** A poster: the detail hero is the biggest place one is drawn. */
  itemPrimary: 720,
  /** A backdrop spans the page. */
  backdrop: 1920,
  /** Wide thumbnails (episode stills, series thumbs). */
  thumb: 960,
  /** A cast or crew photo, drawn as a small avatar or card. */
  person: 400,
} as const

/** Every parameter Emby and Jellyfin read as a size; one present means the caller chose. */
const SIZE_PARAMS = ['maxwidth', 'maxheight', 'width', 'height', 'fillwidth', 'fillheight']

/** The width to request for this image path, or null to leave it as it is. */
export function defaultWidthFor(imagePath: string): number | null {
  const path = imagePath.split('?')[0]
  // Items/{id}/Images/{Type}[/{index}]
  const item = /^Items\/[^/]+\/Images\/([^/]+)/i.exec(path)
  if (item) {
    switch (item[1].toLowerCase()) {
      case 'primary':
        return DEFAULT_IMAGE_WIDTHS.itemPrimary
      case 'backdrop':
        return DEFAULT_IMAGE_WIDTHS.backdrop
      case 'thumb':
      case 'banner':
        return DEFAULT_IMAGE_WIDTHS.thumb
      default:
        // Logos, disc art and the rest are small already, and a logo's
        // transparency is worth more than its bytes.
        return null
    }
  }
  if (/^Persons\/[^/]+\/Images\/Primary/i.test(path)) return DEFAULT_IMAGE_WIDTHS.person
  return null
}

/**
 * The query string to forward, with a default width added when the path is a
 * kind we size and the caller named no size of its own. `queryString` is the
 * raw `?a=b` suffix of the incoming request, or ''.
 */
export function withDefaultImageSize(imagePath: string, queryString: string): string {
  const width = defaultWidthFor(imagePath)
  if (width == null) return queryString

  const params = new URLSearchParams(queryString.startsWith('?') ? queryString.slice(1) : queryString)
  for (const key of params.keys()) {
    if (SIZE_PARAMS.includes(key.toLowerCase())) return queryString
  }
  const extra = `maxWidth=${width}`
  if (!queryString || queryString === '?') return `?${extra}`
  return `${queryString}&${extra}`
}
