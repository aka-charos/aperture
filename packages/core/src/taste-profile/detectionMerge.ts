/**
 * What an auto-detection run reports as newly discovered.
 *
 * Merge mode used to answer a second question with the same filter: which
 * detected entries get *written*. That conflation is what froze every
 * auto-detected franchise and genre weight at whatever the watch history
 * happened to look like the first time that entry appeared. Detection re-ran on
 * every taste-profile rebuild, but an entry that already existed was dropped
 * before it reached the writer, so the only thing merge mode could ever do was
 * append. A user whose viewing shifted from Comedy to Thriller kept their
 * original Comedy weight forever.
 *
 * The two questions are now separate: **every** detected entry is written on
 * every run, and this function answers only "which of these had the user not
 * seen before", which is purely a UI highlighting concern. Hand-set weights are
 * protected in SQL (`WHERE NOT ... is_user_set`), which is the right place for
 * it — the write list is not a permissions boundary and should never be used as
 * one.
 *
 * Deliberately takes no list of things to write and returns no such list, so
 * the old shape cannot be reintroduced by accident.
 */
export function newlyDetectedNames<T>(
  detected: readonly T[],
  nameOf: (item: T) => string,
  existingNames: ReadonlySet<string>,
  mode: 'merge' | 'reset'
): string[] {
  // A reset cleared the table first, so everything that comes back is new.
  if (mode === 'reset') return detected.map(nameOf)

  return detected.filter((item) => !existingNames.has(nameOf(item))).map(nameOf)
}
