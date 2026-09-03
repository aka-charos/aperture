/**
 * Content search source registry.
 *
 * One source today. The list exists so a second one — a direct TMDb source,
 * which would keep search working while Seerr is down — is an entry here plus
 * one file, rather than a change that reaches the web bundle.
 *
 * Sources are tried in order and the first available one answers. There is
 * deliberately no merging: two sources would return the same TMDb rows, so
 * the question is which is authoritative, not how to combine them.
 */
import { seerrSearchSource } from './seerrSource.js'
import type { ContentSearchSource } from './types.js'

export * from './types.js'

const ALL_SOURCES: ContentSearchSource[] = [seerrSearchSource]

/** The first source that can answer, or null when none can. */
export async function resolveSearchSource(): Promise<ContentSearchSource | null> {
  for (const source of ALL_SOURCES) {
    if (await source.isAvailable()) return source
  }
  return null
}
