/**
 * Tags Aperture writes onto media-server items, and the filter that keeps them
 * out of everything Aperture reads back.
 *
 * The home-section sync (../homeSections) marks rows on a viewer's Emby home
 * screen by tagging the original library items. Both media-server mappers copy
 * `item.Tags` into `movies.tags` / `series.tags`, and the canonical text embeds
 * that column as "Themes". Unfiltered, the next library sync would read our own
 * tag back, every recommended title would carry the same token into its vector,
 * and titles recommended to one viewer would drift toward each other — more of
 * them recommended, more of them tagged. The prefix is what breaks the loop.
 *
 * Deliberately NOT the instance name: `{{appName}}` is renamable, and a rename
 * would orphan every tag already on the server. Same reason the STRM paths keep
 * `/aperture-libraries`.
 */

export const MANAGED_TAG_PREFIX = 'aperture:'

export function isManagedTag(tag: string): boolean {
  return tag.trim().toLowerCase().startsWith(MANAGED_TAG_PREFIX)
}

/** An item's tags with every Aperture-managed tag removed. Never undefined. */
export function withoutManagedTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags) return []
  return tags.filter((tag) => typeof tag === 'string' && !isManagedTag(tag))
}
