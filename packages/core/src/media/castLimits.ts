/**
 * How much of a title's cast the library sync keeps (Emby and Jellyfin alike),
 * and how much of it counts as top-billed.
 *
 * The cast list is what the person page, Browse People and the assistant's
 * people search find a person by, so a short list hides someone from every
 * title they are billed low on (a film's twentieth actor is often a known
 * name). `MAX_STORED_ACTORS` only stops a pathological row: a feature's cast
 * in the media server rarely runs past a hundred.
 *
 * Anything that WEIGHS the cast (rankings, connections between titles) reads
 * the top-billed only, so a bit part shared by many titles never outranks the
 * leads: canonical text takes 3–4, Trails `MAX_BILLED_ACTORS`, similarity
 * reasons and Watch Stats' actor ranking `TOP_BILLED_ACTORS` (in SQL through
 * `topBilledActorsSql`, so a ranking and its drill-in read the same text).
 */
export const MAX_STORED_ACTORS = 200

/** The leading actors that count when the cast is weighed (the old stored length). */
export const TOP_BILLED_ACTORS = 20

/**
 * SQL for the first `TOP_BILLED_ACTORS` entries of a JSONB cast column, as a
 * JSONB array; anything but an array reads as an empty one.
 */
export function topBilledActorsSql(column: string): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(column)) {
    throw new Error(`topBilledActorsSql: not a column reference: ${column}`)
  }
  return `(CASE WHEN jsonb_typeof(${column}) = 'array' THEN jsonb_path_query_array(${column}, '$[0 to ${TOP_BILLED_ACTORS - 1}]') ELSE '[]'::jsonb END)`
}
