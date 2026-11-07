/**
 * One request to the media server, shared by the Emby and Jellyfin providers.
 *
 * The deadline covers the whole body, not just the headers: a server that
 * answers and then stalls mid-body (a large episode page while Emby is busy)
 * otherwise holds the request, and the job waiting on it, with no limit.
 *
 * Requests to one server go through a small queue, so several jobs and pages
 * running at once never have more than MEDIA_SERVER_MAX_CONCURRENT_REQUESTS
 * open against it. The deadline starts when a request leaves the queue.
 */

import { concurrencyLimit } from '../lib/asyncCache.js'

export const MEDIA_SERVER_MAX_CONCURRENT_REQUESTS = 4

/** The deadline passed before the whole answer arrived. */
export class MediaServerTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Media server request timed out after ${timeoutMs / 1000} seconds`)
    this.name = 'MediaServerTimeoutError'
  }
}

export interface MediaServerReply {
  ok: boolean
  status: number
  statusText: string
  text: string
}

// Keyed by server address: providers are built per call, the queue is not.
const queues = new Map<string, ReturnType<typeof concurrencyLimit>>()

function queueFor(baseUrl: string) {
  let queue = queues.get(baseUrl)
  if (!queue) {
    queue = concurrencyLimit(MEDIA_SERVER_MAX_CONCURRENT_REQUESTS)
    queues.set(baseUrl, queue)
  }
  return queue
}

/**
 * Sends the request and reads the whole body within `timeoutMs`. Throws
 * `MediaServerTimeoutError` when the deadline passes; any other failure
 * (refused connection, reset mid-body) is rethrown as it came.
 */
export function requestMediaServer(
  baseUrl: string,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<MediaServerReply> {
  return queueFor(baseUrl)(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const text = await response.text()
      return { ok: response.ok, status: response.status, statusText: response.statusText, text }
    } catch (err) {
      if (controller.signal.aborted) throw new MediaServerTimeoutError(timeoutMs)
      throw err
    } finally {
      clearTimeout(timer)
    }
  })
}
