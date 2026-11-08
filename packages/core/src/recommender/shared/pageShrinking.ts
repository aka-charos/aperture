/**
 * Reading a page from the media server when the server fails on large ones.
 *
 * One bad row (Emby answers 500 with a SQLiteException in its log) fails every
 * page that holds it, and a failed page used to fail the whole sync, so a single
 * damaged episode stopped the catalog updating at all. Here a 500 asks again at the
 * same offset with a smaller page. That either gets past the problem or narrows it
 * down to one item, which is tried once more and then skipped: the sync goes on,
 * and because the skipped item is not counted, `listingIsComplete` keeps that
 * library's cleanup off, so nothing is deleted for want of it. Past
 * `MAX_SKIPPED_ITEMS` the server is broken rather than one row, and the sync stops.
 *
 * Pages grow back after a run of successes, so a few brief 500s do not leave the
 * rest of a large library being read one item per request.
 *
 * Only a 500 is retried. A dropped connection, a timeout or a refusal is not a
 * property of the page, and asking again smaller would only take longer to fail.
 * Pure apart from the calls it is handed.
 */
import { MediaServerHttpError } from '../../media/httpError.js'

/** Each failed attempt asks for this share of the last page, and growing reverses it. */
const SHRINK_DIVISOR = 4

/** Successful pages in a row before the page size grows one step. */
const GROW_AFTER_SUCCESSES = 4

/** Items one library may skip before the sync gives up on the server. */
export const MAX_SKIPPED_ITEMS = 20

/** Kept by the caller for one library, so what a page learns reaches the next. */
export interface PageSizing {
  pageSize: number
  maxPageSize: number
  successes: number
  skipped: number
}

export function startPageSizing(maxPageSize: number): PageSizing {
  return { pageSize: maxPageSize, maxPageSize, successes: 0, skipped: 0 }
}

export interface PageRetry {
  startIndex: number
  limit: number
  nextLimit: number
  status: number
  serverException?: string
}

export interface PageSkip {
  startIndex: number
  status: number
  serverException?: string
}

/** The page, or null when the one item at this offset could not be read and was skipped. */
export async function fetchPageShrinking<T>(
  fetchPage: (startIndex: number, limit: number) => Promise<T>,
  startIndex: number,
  sizing: PageSizing,
  label: string,
  on: { retry: (retry: PageRetry) => void; skip: (skip: PageSkip) => void }
): Promise<T | null> {
  let triedSingleTwice = false

  for (;;) {
    try {
      const page = await fetchPage(startIndex, sizing.pageSize)
      sizing.successes++
      if (sizing.successes >= GROW_AFTER_SUCCESSES && sizing.pageSize < sizing.maxPageSize) {
        sizing.pageSize = Math.min(sizing.maxPageSize, sizing.pageSize * SHRINK_DIVISOR)
        sizing.successes = 0
      }
      return page
    } catch (err) {
      if (!(err instanceof MediaServerHttpError) || err.status !== 500) throw err

      sizing.successes = 0
      const limit = sizing.pageSize
      const { status, serverException } = err

      if (limit > 1) {
        const nextLimit = Math.max(1, Math.floor(limit / SHRINK_DIVISOR))
        sizing.pageSize = nextLimit
        on.retry({ startIndex, limit, nextLimit, status, serverException })
        continue
      }

      // A brief 500 can land on a single item as easily as on a page.
      if (!triedSingleTwice) {
        triedSingleTwice = true
        continue
      }

      if (sizing.skipped >= MAX_SKIPPED_ITEMS) {
        throw new Error(
          `The media server answered HTTP ${status}${serverException ? ` (${serverException})` : ''} ` +
            `for more than ${MAX_SKIPPED_ITEMS} single items of ${label}, the last at offset ${startIndex}. ` +
            `Check its log around ${new Date().toISOString()} for the full error.`,
          { cause: err }
        )
      }
      sizing.skipped++
      on.skip({ startIndex, status, serverException })
      return null
    }
  }
}
