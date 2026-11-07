/**
 * Emby Provider Base
 */

import { createChildLogger } from '../../lib/logger.js'
import {
  MediaServerTimeoutError,
  requestMediaServer,
  type MediaServerReply,
} from '../serverRequest.js'
import {
  EMBY_FETCH_TIMEOUT_MS,
  embyConnectionError,
  embyHttpError,
  embyTimeoutError,
  parseEmbyResponseBody,
  summarizeEmbyItemsResponse,
} from './fetchHelpers.js'

export const logger = createChildLogger('emby-provider')

export class EmbyProviderBase {
  readonly type = 'emby' as const
  readonly baseUrl: string
  protected readonly clientName = 'Aperture'
  protected readonly deviceId = 'aperture-server'
  protected readonly deviceName = 'Aperture Server'
  protected readonly clientVersion = '1.0.0'

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  getAuthHeader(apiKey: string): string {
    return `MediaBrowser Client="${this.clientName}", Device="${this.deviceName}", DeviceId="${this.deviceId}", Version="${this.clientVersion}", Token="${apiKey}"`
  }

  async fetch<T>(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'X-Emby-Authorization': this.getAuthHeader(apiKey),
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    logger.debug({ method: options.method || 'GET', url }, '📡 Emby API Request')

    const startTime = Date.now()
    let response: MediaServerReply
    try {
      response = await requestMediaServer(
        this.baseUrl,
        url,
        { ...options, headers },
        EMBY_FETCH_TIMEOUT_MS
      )
    } catch (err) {
      const duration = Date.now() - startTime
      if (err instanceof MediaServerTimeoutError) {
        logger.error(
          { url, duration },
          `⏱️ Emby API request timed out after ${EMBY_FETCH_TIMEOUT_MS / 1000} seconds`
        )
        throw embyTimeoutError(this.baseUrl)
      }
      logger.error({ url, duration, err }, '❌ Emby API network error')
      throw embyConnectionError(this.baseUrl)
    }
    const duration = Date.now() - startTime
    const { text } = response

    if (!response.ok) {
      logger.error({ status: response.status, url, body: text, duration }, '❌ Emby API error')
      throw embyHttpError(response.status, response.statusText, text)
    }

    if (!text) {
      logger.debug({ url, duration, empty: true }, '✅ Emby API Response (empty)')
      return {} as T
    }

    const data = parseEmbyResponseBody<T>(text)

    logger.debug(
      {
        url,
        duration,
        responseSize: text.length,
        ...summarizeEmbyItemsResponse(data),
      },
      '✅ Emby API Response'
    )

    return data
  }

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
