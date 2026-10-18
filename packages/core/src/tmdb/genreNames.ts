/**
 * Library genres are stored as the English names TMDb (through the media
 * server) supplied. TMDb publishes the same genre list in every language with
 * the same ids, so the English list and a localized one pair up by id into
 * "English name → localized name" — which is how a stored genre is printed in
 * any language without a hand-written string per language.
 *
 * Pure: no DB, no network.
 */

export interface GenreListEntry {
  id: number
  name: string
}

/**
 * English name → localized name, for every id present in both lists with a
 * non-empty localized name that differs from the English one (an identical
 * name adds nothing, and TMDb answers an untranslated genre with the English
 * text). Several lists (movie, TV) merge; the first pairing of a name wins.
 */
export function pairGenreNames(
  lists: ReadonlyArray<{ english: readonly GenreListEntry[]; localized: readonly GenreListEntry[] }>
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const { english, localized } of lists) {
    const byId = new Map(localized.map((g) => [g.id, g.name.trim()] as const))
    for (const g of english) {
      const from = g.name.trim()
      const to = byId.get(g.id)
      if (!from || !to || to === from || from in names) continue
      names[from] = to
    }
  }
  return names
}
