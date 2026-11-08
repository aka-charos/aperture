/**
 * Reading a page from the media server when the server fails on large ones.
 *
 * One bad row (Emby answers 500 with a SQLiteException in its log) fails every
 * page that holds it, and a failed page used to fail the whole sync, so a single
 * damaged episode stopped the catalog updating at all. Retrying at the same offset
 * with a smaller page either gets past the problem or narrows it down to one item,
 * and the message then says where to look.
 *
 * Only a 500 is retried. A dropped connection, a timeout or a refusal is not a
 * property of the page, and asking again smaller would only take longer to fail.
 * Pure apart from the calls it is handed.
 */
import { MediaServerHttpError } from '../../media/httpError.js'

/** Each failed attempt asks for this share of the last page. */
const SHRINK_DIVISOR = 4

export interface PageRetry {
  startIndex: number
  limit: number
  nextLimit: number
  status: number
  serverException?: string
}

export async function fetchPageShrinking<T>(
  fetchPage: (startIndex: number, limit: number) => Promise<T>,
  startIndex: number,
  /** Kept by the caller: once a library needs smaller pages, later pages start there. */
  size: { pageSize: number },
  label: string,
  onRetry: (retry: PageRetry) => void
): Promise<T> {
  for (;;) {
    try {
      return await fetchPage(startIndex, size.pageSize)
    } catch (err) {
      if (!(err instanceof MediaServerHttpError) || err.status !== 500) throw err

      const limit = size.pageSize
      const { status, serverException } = err
      if (limit === 1) {
        throw new Error(
          `The media server answered HTTP ${status}${serverException ? ` (${serverException})` : ''} ` +
            `for the single item at offset ${startIndex} of ${label}. ` +
            `Check its log around ${new Date().toISOString()} for the full error.`,
          { cause: err }
        )
      }
      const nextLimit = Math.max(1, Math.floor(limit / SHRINK_DIVISOR))
      size.pageSize = nextLimit
      onRetry({ startIndex, limit, nextLimit, status, serverException })
    }
  }
}
