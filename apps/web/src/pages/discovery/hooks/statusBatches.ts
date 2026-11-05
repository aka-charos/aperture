import type { MediaType, SeerrMediaStatus } from '../types'

export interface StatusItem {
  tmdbId: number
  mediaType: MediaType
}

export interface StatusBatch {
  mediaType: MediaType
  items: StatusItem[]
}

/** The route refuses more than this in one request. */
export const STATUS_BATCH_SIZE = 100

/** A title with no answer after this many tries stays without a badge until the page reopens. */
export const MAX_STATUS_ATTEMPTS = 3
/** Long enough for a slow Seerr to catch up; only titles still unanswered are asked again. */
export const STATUS_RETRY_MS = 15_000

/** A movie and a show can share a TMDb id, so a status is never keyed by the id alone. */
export function mediaKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`
}

/**
 * The requests still to make for these titles, marking each as asked. One media
 * type per request, because the route answers by bare TMDb id, where a movie and a
 * show sharing an id would collide. Titles with no TMDb id are left out.
 */
export function pendingStatusBatches(
  items: readonly StatusItem[],
  asked: Set<string>,
  batchSize = STATUS_BATCH_SIZE
): StatusBatch[] {
  const byType = new Map<MediaType, StatusItem[]>()
  for (const { tmdbId, mediaType } of items) {
    if (!(tmdbId > 0)) continue
    const key = mediaKey(mediaType, tmdbId)
    if (asked.has(key)) continue
    asked.add(key)
    const list = byType.get(mediaType)
    if (list) list.push({ tmdbId, mediaType })
    else byType.set(mediaType, [{ tmdbId, mediaType }])
  }

  const batches: StatusBatch[] = []
  for (const [mediaType, list] of byType) {
    for (let i = 0; i < list.length; i += batchSize) {
      batches.push({ mediaType, items: list.slice(i, i + batchSize) })
    }
  }
  return batches
}

/** One batch's answer under typed keys. A title Seerr did not answer for has no entry. */
export function typedStatuses(
  batch: StatusBatch,
  statuses: Record<string, SeerrMediaStatus> | undefined
): Record<string, SeerrMediaStatus> {
  const typed: Record<string, SeerrMediaStatus> = {}
  for (const { tmdbId } of batch.items) {
    const status = statuses?.[tmdbId]
    if (status) typed[mediaKey(batch.mediaType, tmdbId)] = status
  }
  return typed
}

/**
 * Puts a batch's unanswered titles back to be asked again, until they have had their
 * tries. A failed request and a title the server left out (its time ran out, or Seerr
 * did not answer) are the same case. Answers true when anything is due again.
 */
export function forgetUnanswered(
  batch: StatusBatch,
  answers: Record<string, SeerrMediaStatus>,
  asked: Set<string>,
  attempts: Map<string, number>
): boolean {
  let due = false
  for (const { tmdbId, mediaType } of batch.items) {
    const key = mediaKey(mediaType, tmdbId)
    if (answers[key]) continue
    const tries = (attempts.get(key) ?? 0) + 1
    attempts.set(key, tries)
    if (tries < MAX_STATUS_ATTEMPTS) {
      asked.delete(key)
      due = true
    }
  }
  return due
}
