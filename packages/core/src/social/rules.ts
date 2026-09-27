/**
 * The rules of the social layer — who counts as a connection, what a person
 * is called, and why a recommendation to someone is skipped.
 *
 * Pure, and deliberately free of runtime imports, so `rules.test.ts` pins them
 * without loading the database pool (the `seerrMapping.ts` pattern).
 *
 * Connections are made by an admin and are mutual: two connected people see
 * each other's watch history, recent watches and names on titles, and can
 * recommend titles to each other. There is no direction and no opt-out.
 *
 * Three rules everything else in `social/` leans on.
 *
 * 1. **One definition of a VISIBLE connection** (`visibleConnectionsSql`):
 *    connected, and the other account has access here (`is_enabled`) and is
 *    not disabled on the media server (`NOT provider_disabled`). That is the
 *    population the session lookup and every per-user job already use, so a
 *    person who has lost access is hidden from their connections everywhere
 *    at once, and comes back everywhere at once when access returns. Rows are
 *    never deleted for it — switching access off keeps an account's setup.
 *
 * 2. **The database orders a pair, never TypeScript.** A string `<` on uuids
 *    disagrees with Postgres' uuid ordering as soon as a client sends upper- or
 *    mixed-case ids, and the table's `user_id_a < user_id_b` CHECK then fails
 *    with a 500. `validatePair` lowercases and validates; `LEAST`/`GREATEST`
 *    order at insert.
 *
 * 3. **Out of scope outranks watched** (`recipientSkipReason`): a title the
 *    recipient cannot open says nothing about their history, so "already
 *    watched" is only ever reported for a title they could have watched here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a string is a well-formed uuid, in any letter case. */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/**
 * Lowercase and validate both ends of a pair. Throws a `RangeError` on a
 * malformed id or a self-pair (in any letter case). Does NOT order them — the
 * database does (rule 2).
 */
export function validatePair(a: string, b: string): [string, string] {
  if (typeof a !== 'string' || typeof b !== 'string' || !UUID.test(a) || !UUID.test(b)) {
    throw new RangeError('A connection needs two valid user ids')
  }
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left === right) {
    throw new RangeError('A user cannot be connected to themselves')
  }
  return [left, right]
}

/**
 * The display-name rule: the display name when it has any text, otherwise the
 * username. Shared with the named-watchers query, so a person is called the
 * same thing on every surface.
 */
export function displayNameSql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(COALESCE(${alias}.display_name, '')), ''), ${alias}.username)`
}

/**
 * THE definition of "a connection this viewer can see" (rule 1), as a subquery
 * yielding one `user_id` column. Every social read goes through it: named
 * watchers, the watch-history guard, recent watches, the recipient list and the
 * inbox. `viewer` is a SQL expression such as `'$1::uuid'`. The aliases `c` and
 * `cu` are scoped to the subquery.
 */
export function visibleConnectionsSql(viewer: string): string {
  return `SELECT CASE WHEN c.user_id_a = ${viewer} THEN c.user_id_b ELSE c.user_id_a END AS user_id
            FROM user_connections c
            JOIN users cu ON cu.id = CASE WHEN c.user_id_a = ${viewer} THEN c.user_id_b ELSE c.user_id_a END
           WHERE (c.user_id_a = ${viewer} OR c.user_id_b = ${viewer})
             AND cu.is_enabled = true AND cu.provider_disabled = false`
}

/**
 * Why a recipient was left out of a send.
 *
 * - `not_connected`: not a visible connection of the sender (also covers the
 *   sender's own id, an unknown id, and a connection who lost access).
 * - `unavailable`: the title is outside the recipient's library scope or above
 *   their parental rating, so they could never open it.
 * - `already_watched`: they have finished it.
 */
export type SkipReason = 'not_connected' | 'unavailable' | 'already_watched'

/**
 * Precedence: not_connected > unavailable > already_watched > (send). Rule 3:
 * out of scope wins over watched, so a title the recipient cannot open says
 * nothing about their history.
 */
export function recipientSkipReason(s: {
  connected: boolean
  inScope: boolean
  finished: boolean
}): SkipReason | null {
  if (!s.connected) return 'not_connected'
  if (!s.inScope) return 'unavailable'
  if (s.finished) return 'already_watched'
  return null
}

export interface InboxGroup<Row> {
  recommenderId: string
  recommenderName: string
  items: Row[]
}

/**
 * Inbox rows (newest first) into one group per recommender. Groups are ordered
 * by the recommender's name, so a page does not reshuffle its sections every
 * time someone sends something; items keep the row order they arrived in, which
 * is newest first.
 */
export function groupInbox<Row extends { recommenderId: string; recommenderName: string }>(
  rows: readonly Row[]
): Array<InboxGroup<Row>> {
  const groups = new Map<string, InboxGroup<Row>>()
  for (const row of rows) {
    let group = groups.get(row.recommenderId)
    if (!group) {
      group = { recommenderId: row.recommenderId, recommenderName: row.recommenderName, items: [] }
      groups.set(row.recommenderId, group)
    }
    group.items.push(row)
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.recommenderName.localeCompare(b.recommenderName, undefined, { sensitivity: 'base' }) ||
      (a.recommenderId < b.recommenderId ? -1 : a.recommenderId > b.recommenderId ? 1 : 0)
  )
}
