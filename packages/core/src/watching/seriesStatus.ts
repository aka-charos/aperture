/**
 * Whether a series status means the show is over. Pure: shared by the Watching
 * page, the episodes route and the assistant, which must agree about one show.
 * TMDb says "Ended" or "Canceled"; a media server says "Ended".
 */
export function isEndedStatus(status: string | null | undefined): boolean {
  return status === 'Ended' || status === 'Canceled'
}
