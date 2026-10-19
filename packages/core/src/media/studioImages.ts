/**
 * Which image of a studio item Aperture shows, read from what the media server
 * reports. Shared by the Emby and Jellyfin providers, which both list studios
 * at `/Studios` with an `ImageTags` map.
 *
 * No DB; the provider's request is passed in, so it is pinned by
 * studioImages.test.ts against a stub.
 */

import type { MediaServerStudio, StudioImageType } from './types.js'

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

/** The one thing `getStudios` needs from a provider: its authenticated GET. */
export interface StudioListSource {
  fetch<T>(endpoint: string, apiKey: string): Promise<T>
}

interface StudioItem {
  Id?: string
  Name?: string
  ImageTags?: Record<string, string>
}

/**
 * Every studio the server lists, with the image to show for each. One copy for
 * both providers: Emby and Jellyfin answer `/Studios` the same way.
 *
 * Read-only: Aperture never uploads a studio image (core
 * enrichment/studioLogos.ts says why). One unpaged request;
 * `IncludeItemTypes` is ignored by `/Studios`, so movie studios and series
 * networks come back as one list.
 */
export async function getStudios(source: StudioListSource, apiKey: string): Promise<MediaServerStudio[]> {
  const params = new URLSearchParams({
    Recursive: 'true',
    Fields: 'ImageTags',
    EnableImages: 'true',
    EnableImageTypes: STUDIO_IMAGE_PREFERENCE.join(','),
  })
  const response = await source.fetch<{ Items?: StudioItem[] }>(`/Studios?${params}`, apiKey)
  return (response.Items ?? []).flatMap((item) =>
    item.Id && item.Name ? [{ id: item.Id, name: item.Name, image: pickStudioImage(item.ImageTags) }] : []
  )
}
