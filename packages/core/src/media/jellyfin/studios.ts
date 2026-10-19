/**
 * Jellyfin Studios Module
 *
 * Read-only: Aperture lists studios and the images the server holds for them,
 * and never uploads one (core enrichment/studioLogos.ts says why).
 */

import type { MediaServerStudio } from '../types.js'
import { pickStudioImage } from '../studioImages.js'
import type { JellyfinProviderBase } from './base.js'

interface StudioItem {
  Id: string
  Name: string
  ImageTags?: Record<string, string>
}

export async function getStudios(
  provider: JellyfinProviderBase,
  apiKey: string
): Promise<MediaServerStudio[]> {
  // One unpaged request; IncludeItemTypes is ignored by /Studios, so movie
  // studios and series networks come back as one list.
  const params = new URLSearchParams({
    Recursive: 'true',
    Fields: 'ImageTags',
    EnableImages: 'true',
    EnableImageTypes: 'Thumb,Primary',
  })
  const response = await provider.fetch<{ Items?: StudioItem[] }>(`/Studios?${params}`, apiKey)
  return (response.Items ?? [])
    .filter((item) => item.Id && item.Name)
    .map((item) => ({ id: item.Id, name: item.Name, image: pickStudioImage(item.ImageTags) }))
}
