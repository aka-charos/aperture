/**
 * How much of a title's cast the library sync keeps (Emby and Jellyfin alike).
 *
 * The cast list is what the person page, Browse People and the assistant's
 * people search find a person by, so a short list hides someone from every
 * title they are billed low on (a film's twentieth actor is often a known
 * name). The bound only stops a pathological row: a feature's cast in the
 * media server rarely runs past a hundred.
 *
 * Readers that want the leads take their own slice (canonical text: 3–4;
 * Trails: `MAX_BILLED_ACTORS`; similarity reasons: `REASON_BILLED_ACTORS`).
 */
export const MAX_STORED_ACTORS = 200
