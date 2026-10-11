/**
 * Fetching an image to carry inside a message. No database.
 *
 * Never throws: an email missing a poster is still worth sending, so every
 * failure (unreachable, not an image, too large, too slow) answers null and
 * the caller leaves the item's image out. The size is capped WHILE reading,
 * not after — a server that lies about Content-Length, or sends none, cannot
 * make the API buffer an arbitrarily large body.
 */
import { createChildLogger } from '../lib/logger.js'
import { EMAIL_IMAGE_MAX_BYTES, isContentId, isEmailImageType, type EmailImage } from './rules.js'
import { safeUrl } from './template.js'

const logger = createChildLogger('smtp')

export const EMAIL_IMAGE_FETCH_TIMEOUT_MS = 8_000

export interface FetchEmailImageOptions {
  timeoutMs?: number
  maxBytes?: number
}

export async function fetchEmailImage(
  url: string,
  cid: string,
  options: FetchEmailImageOptions = {}
): Promise<EmailImage | null> {
  const maxBytes = options.maxBytes ?? EMAIL_IMAGE_MAX_BYTES
  const href = safeUrl(url)
  if (!href || !isContentId(cid)) return null

  try {
    // No redirects: the http(s) check above covers only the address asked
    // for, and a redirect could send this server-side request anywhere,
    // internal addresses included. A redirect answers null like any non-200.
    const response = await fetch(href, {
      signal: AbortSignal.timeout(options.timeoutMs ?? EMAIL_IMAGE_FETCH_TIMEOUT_MS),
      redirect: 'manual',
    })
    if (!response.ok || !response.body) return null

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    if (!isEmailImageType(contentType)) {
      await response.body.cancel()
      return null
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel()
      return null
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    if (total === 0) return null
    return { cid, content: Buffer.concat(chunks), contentType }
  } catch (err) {
    logger.debug({ err, url: href }, 'Email image not fetched')
    return null
  }
}
