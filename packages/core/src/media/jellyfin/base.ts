/**
 * Jellyfin Provider Base
 *
 * Core class with constructor, authentication helpers, and fetch functionality.
 */

import { MediaServerHttpError } from '../httpError.js'
import { createChildLogger } from '../../lib/logger.js'
import {
  MediaServerIncompleteResponseError,
  MediaServerTimeoutError,
  requestMediaServer,
  type MediaServerReply,
} from '../serverRequest.js'

export const logger = createChildLogger('jellyfin-provider')

function jellyfinIncompleteResponseError(): Error {
  return new Error(
    'Jellyfin answered but stopped partway through its response. The server is reachable; it may be overloaded.'
  )
}

export class JellyfinProviderBase {
  readonly type = 'jellyfin' as const
  readonly baseUrl: string
  protected readonly clientName = 'Aperture'
  protected readonly deviceId = 'aperture-server'
  protected readonly deviceName = 'Aperture Server'
  protected readonly clientVersion = '1.0.0'

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '') // Remove trailing slash
  }

  getAuthHeader(apiKey?: string): string {
    let header = `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}"`
    if (apiKey) {
      header += `, Token="${apiKey}"`
    }
    return header
  }

  async fetch<T>(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(apiKey),
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    const startTime = Date.now()
    let response: MediaServerReply
    try {
      // 60 seconds for a slot, for the answer to start, and of silence in the
      // body (a large library's listing may stream longer than that).
      response = await requestMediaServer(this.baseUrl, url, { ...options, headers }, 60_000)
    } catch (err) {
      const duration = Date.now() - startTime
      if (err instanceof MediaServerTimeoutError) {
        logger.error({ url, duration, stage: err.stage }, `⏱️ Jellyfin API request: ${err.message}`)
        if (err.stage === 'queue') {
          throw new Error(
            "Jellyfin is busy: Aperture's requests to it did not finish within 60 seconds, so this one was not sent."
          )
        }
        if (err.stage === 'body') throw jellyfinIncompleteResponseError()
        throw new Error(
          `Connection to Jellyfin timed out after 60 seconds. Please check that your media server URL (${this.baseUrl}) is accessible from the Aperture container.`
        )
      }
      // The server answered, so this is not a connection problem.
      if (err instanceof MediaServerIncompleteResponseError) {
        logger.error({ url, duration, status: err.status, err: err.cause }, '❌ Jellyfin API response broke off')
        throw jellyfinIncompleteResponseError()
      }
      logger.error({ url, duration, err }, '❌ Jellyfin API network error')
      throw new Error(
        `Failed to connect to Jellyfin at ${this.baseUrl}. Please verify the URL is correct and the server is running.`
      )
    }
    const duration = Date.now() - startTime
    const { text } = response

    if (!response.ok) {
      logger.error({ status: response.status, url, body: text, duration }, '❌ Jellyfin API error')
      throw new MediaServerHttpError('Jellyfin', response.status, response.statusText, text)
    }

    // Some endpoints return empty response
    if (!text) {
      logger.debug({ url, duration, empty: true }, '✅ Jellyfin API Response (empty)')
      return {} as T
    }

    const data = JSON.parse(text) as T
    logger.debug({ url, duration, responseSize: text.length }, '✅ Jellyfin API Response')

    return data
  }

  // Utility methods for image URLs
  getPosterUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Primary${params}`
  }

  getBackdropUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Backdrop${params}`
  }

  getBannerUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Banner${params}`
  }

  getLogoUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Logo${params}`
  }

  getArtUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Art${params}`
  }

  getThumbUrl(itemId: string, imageTag?: string): string {
    const params = imageTag ? `?tag=${imageTag}` : ''
    return `${this.baseUrl}/Items/${itemId}/Images/Thumb${params}`
  }

  getStreamUrl(itemId: string): string {
    return `${this.baseUrl}/Videos/${itemId}/stream`
  }
}



