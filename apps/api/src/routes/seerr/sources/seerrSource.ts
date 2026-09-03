/**
 * Seerr-backed content search.
 *
 * Seerr's `GET /search` is a TMDb `search/multi` wrapper that also decorates
 * each result with `mediaInfo` — so one call answers both "what matches this
 * query" and "has anyone requested it", which a direct TMDb call would need a
 * second round trip for.
 *
 * Everything Seerr-shaped stops here. The mapping to Aperture's vocabulary is
 * the whole reason this file exists rather than the route calling core
 * directly.
 */
import { isSeerrConfigured, seerrSearchContent } from '@aperture/core'
import { mapSeerrSearchItem } from './seerrMapping.js'
import type {
  ContentSearchItem,
  ContentSearchPage,
  ContentSearchSource,
} from './types.js'

export const seerrSearchSource: ContentSearchSource = {
  id: 'seerr',

  isAvailable: () => isSeerrConfigured(),

  async search(query: string, page: number): Promise<ContentSearchPage> {
    const result = await seerrSearchContent(query, page)
    if (!result) {
      throw new Error('Seerr search returned no response')
    }

    return {
      page: result.page ?? page,
      totalPages: result.totalPages ?? 1,
      totalResults: result.totalResults ?? 0,
      results: (result.results ?? [])
        .map(mapSeerrSearchItem)
        .filter((item): item is ContentSearchItem => item !== null),
    }
  },
}
