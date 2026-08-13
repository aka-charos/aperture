/**
 * Web search source registry + orchestration.
 *
 * Runs every registered source concurrently and returns those that produced
 * usable grounded text. The combine order is the array order below. Add a new
 * source (e.g. SearxNG) by implementing WebSearchSource and appending it here.
 */
import { createChildLogger } from '@aperture/core'
import type { WebSearchSource, WebSearchSourceResult, WebSearchContext } from './types.js'
import { googleGroundingSource } from './googleGrounding.js'
import { tavilySource } from './tavily.js'

export * from './types.js'

const logger = createChildLogger('web-sources')

/** All registered web-search sources. Order = the order material is combined in. */
const ALL_SOURCES: WebSearchSource[] = [googleGroundingSource, tavilySource]

/**
 * Gather grounded material from every enabled source, concurrently. Each source
 * already fails open to null; the extra catch is belt-and-suspenders so one
 * broken source can't sink the others. Returns only sources that yielded text.
 */
export async function gatherFromSources(
  query: string,
  context?: WebSearchContext
): Promise<WebSearchSourceResult[]> {
  const settled = await Promise.all(
    ALL_SOURCES.map((source) =>
      source.gather(query, context).catch((err) => {
        logger.warn({ err, source: source.id }, 'Web search source threw; ignoring')
        return null
      })
    )
  )

  const results = settled.filter(
    (r): r is WebSearchSourceResult => !!r && !!r.text.trim()
  )
  logger.info(
    { contributing: results.map((r) => r.source), registered: ALL_SOURCES.length },
    'Web search sources gathered'
  )
  return results
}
