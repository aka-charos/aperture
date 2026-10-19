/**
 * Which image of a studio item Aperture shows, read from what the media server
 * reports. Shared by the Emby and Jellyfin providers, which both list studios
 * at `/Studios` with an `ImageTags` map.
 *
 * Pure, no DB, pinned by studioImages.test.ts.
 */

import type { StudioImageType } from './types.js'

/**
 * Thumb first: Emby's built-in studio images are all Thumbs, and its Networks
 * screen draws the Thumb. Primary second, because an admin uploading a logo by
 * hand gets Primary by default. Anything else is not a studio logo.
 */
export const STUDIO_IMAGE_PREFERENCE: readonly StudioImageType[] = ['Thumb', 'Primary']

/** The image to show for one studio item, or null when it holds none. */
export function pickStudioImage(
  imageTags: Record<string, string> | null | undefined
): { type: StudioImageType; tag: string } | null {
  for (const type of STUDIO_IMAGE_PREFERENCE) {
    const tag = imageTags?.[type]
    if (tag) return { type, tag }
  }
  return null
}
