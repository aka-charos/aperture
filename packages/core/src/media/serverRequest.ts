/**
 * One request to the media server, shared by the Emby and Jellyfin providers.
 *
 * Three limits, each with its own job:
 *
 * - The QUEUE. Requests to one server go through a small queue, so several
 *   jobs and pages running at once never have more than
 *   MEDIA_SERVER_MAX_CONCURRENT_REQUESTS open against it. A request waits at
 *   most `timeoutMs` for a place; past that it fails as busy rather than
 *   wait behind stalled requests for as long as they take.
 * - The HEADERS. `timeoutMs` from leaving the queue to the response starting.
 * - The BODY. A body may take as long as it needs while data keeps arriving;
 *   it fails after `timeoutMs` with nothing received. A whole-body deadline
 *   would fail a large listing streaming slowly over a remote link, which
 *   used to work; without any limit, a server that answers and then stalls
 *   mid-body held the request, and the job waiting on it, indefinitely.
 */

export const MEDIA_SERVER_MAX_CONCURRENT_REQUESTS = 4

/** The server did not answer, or went silent, for longer than allowed. */
export class MediaServerTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly stage: 'queue' | 'headers' | 'body'
  ) {
    super(
      stage === 'queue'
        ? `Media server busy: no request slot within ${timeoutMs / 1000} seconds`
        : stage === 'headers'
          ? `Media server request timed out after ${timeoutMs / 1000} seconds`
          : `Media server stopped sending its response for ${timeoutMs / 1000} seconds`
    )
    this.name = 'MediaServerTimeoutError'
  }
}

/** The server answered, then the response broke off before it was complete. */
export class MediaServerIncompleteResponseError extends Error {
  constructor(
    readonly status: number,
    cause: unknown
  ) {
    super(`Media server response broke off after status ${status}`, { cause })
    this.name = 'MediaServerIncompleteResponseError'
  }
}

export interface MediaServerReply {
  ok: boolean
  status: number
  statusText: string
  text: string
}

/** A FIFO queue whose waiters can give up. */
class RequestQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  /** Resolves with a release function, or rejects once `waitMs` passes. */
  acquire(waitMs: number): Promise<() => void> {
    const release = () => {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve(release)
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer)
        resolve(release)
      }
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(grant)
        if (at >= 0) this.waiting.splice(at, 1)
        reject(new MediaServerTimeoutError(waitMs, 'queue'))
      }, waitMs)
      this.waiting.push(grant)
    })
  }
}

// Keyed by server address: providers are built per call, the queue is not.
const queues = new Map<string, RequestQueue>()

function queueFor(baseUrl: string): RequestQueue {
  let queue = queues.get(baseUrl)
  if (!queue) {
    queue = new RequestQueue(MEDIA_SERVER_MAX_CONCURRENT_REQUESTS)
    queues.set(baseUrl, queue)
  }
  return queue
}

/**
 * Sends the request and reads the whole body. Throws
 * `MediaServerTimeoutError` when a limit above passes,
 * `MediaServerIncompleteResponseError` when the body breaks off after the
 * server answered, and rethrows anything else (a refused connection) as it
 * came.
 */
export async function requestMediaServer(
  baseUrl: string,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<MediaServerReply> {
  const release = await queueFor(baseUrl).acquire(timeoutMs)
  const controller = new AbortController()
  let stage: 'headers' | 'body' = 'headers'
  let timer = setTimeout(() => controller.abort(), timeoutMs)
  const quiet = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), timeoutMs)
  }
  let response: Response | undefined
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
    stage = 'body'
    quiet()
    let text = ''
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        quiet()
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    }
    return { ok: response.ok, status: response.status, statusText: response.statusText, text }
  } catch (err) {
    if (controller.signal.aborted) throw new MediaServerTimeoutError(timeoutMs, stage)
    if (response) throw new MediaServerIncompleteResponseError(response.status, err)
    throw err
  } finally {
    clearTimeout(timer)
    release()
  }
}
