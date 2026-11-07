/**
 * Which Browse list reply may still be applied.
 *
 * Each Browse list (movies, series, people) asks for page one when its query
 * changes and for the next page as the reader scrolls. Nothing used to cancel
 * a request once sent, so a slow reply to an older query could land after the
 * newer one and replace it, its rows and total shown under the new filters, and
 * an old "load more" could append its rows to a different list. The list
 * memory then filed those rows under the new query, so Back restored them.
 *
 * The hooks hold a request guard whose generation ends when the list's query
 * changes (`useRequestGuard(listQuery)`). This adds the one rule the guard does
 * not know: asking for page one starts a new list, so it ends the generation
 * too, which cancels a "load more" still in flight for the list it replaces.
 * A reply is applied only while `ticket.isCurrent()`, and the loading flags are
 * cleared only by the current request.
 */
import type { RequestGuard, RequestTicket } from '../../../lib/requestGuard'

export function beginListRequest(guard: RequestGuard, append: boolean): RequestTicket {
  if (!append) guard.invalidate()
  return guard.begin()
}
