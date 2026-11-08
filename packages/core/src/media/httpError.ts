/**
 * A media server answered, with an error status. Separate from a connection
 * failure, and carrying the status as a field so a caller can decide on it without
 * reading the message. The message's wording stays what it always was, because
 * `isEmbyNotFoundError` matches on it.
 */
export class MediaServerHttpError extends Error {
  readonly serverException?: 'SQLiteException'

  constructor(
    server: 'Emby' | 'Jellyfin',
    readonly status: number,
    statusText: string,
    body: string
  ) {
    super(`${server} API error: ${status} ${statusText}`)
    this.name = 'MediaServerHttpError'
    if (body.includes('SQLiteException')) this.serverException = 'SQLiteException'
  }
}
