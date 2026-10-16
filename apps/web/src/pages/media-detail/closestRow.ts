/**
 * One row of "closest titles" for the insights panel, merging the evidence
 * lookup with a taste-twin pick's shared titles.
 *
 * They used to be two rows that contradicted each other. The twin card showed
 * the rarest films the two viewers shared under "this overlap is what
 * identified the match" — an arbitrary slice of a tie, unrelated to the pick —
 * while the strongest evidence (Anomalisa at 81% beside Synecdoche, New York)
 * sat further down captioned "not why it was picked". The shared titles are now
 * the ones both viewers played nearest to the pick, carrying the same raw
 * cosine as an evidence row, so the two lists answer one question and belong in
 * one row: what in your history this resembles, with the titles your twin
 * watched too marked as such.
 *
 * Pure, so the merge is pinned without rendering anything.
 */

export interface ClosestRowInput {
  evidence: Array<{
    id: string
    similarity: number
    evidence_type: string
    item: { id: string; title: string; year: number | null; poster_url: string | null }
  }>
  twinShared: Array<{
    id: string
    title: string
    year: number | null
    poster_url: string | null
    similarity: number | null
  }>
}

export interface ClosestRowItem {
  /** Stable React key. */
  key: string
  id: string
  title: string
  year: number | null
  poster_url: string | null
  /** Raw cosine to the pick; null only for a shared title with no vector. */
  similarity: number | null
  /** The evidence badge (favourite / recent / watched); null for a shared-only title. */
  evidenceType: string | null
  /** The taste twin played it too. */
  sharedWithTwin: boolean
}

/**
 * Whether the twin's titles are marked one by one, or said once.
 *
 * `some`: a badge on each title the twin also watched, which tells the reader
 * which ones. `all`: every title in the row is shared — normal for a strong
 * twin, since the films nearest a pick are then mostly ones both watched — so
 * a badge on every poster says nothing a single caption does not, and the
 * caption says it instead. `none`: no twin titles at all.
 */
export type TwinMarking = 'none' | 'some' | 'all'

export function twinMarking(row: ClosestRowItem[]): TwinMarking {
  const shared = row.filter((item) => item.sharedWithTwin).length
  if (shared === 0) return 'none'
  return shared === row.length ? 'all' : 'some'
}

/**
 * Evidence and shared titles as one list, closest first.
 *
 * A title in both lists appears once, keeping its evidence badge and gaining
 * the twin mark. A shared title with no measured similarity sorts last rather
 * than claiming a closeness nobody measured. Ties keep evidence order first,
 * then the stored shared order, so the row is stable between renders.
 */
export function buildClosestRow({ evidence, twinShared }: ClosestRowInput): ClosestRowItem[] {
  const sharedIds = new Set(twinShared.map((item) => item.id))
  const rows: ClosestRowItem[] = []
  const seen = new Set<string>()

  for (const ev of evidence) {
    if (seen.has(ev.item.id)) continue
    seen.add(ev.item.id)
    rows.push({
      key: ev.id,
      id: ev.item.id,
      title: ev.item.title,
      year: ev.item.year,
      poster_url: ev.item.poster_url,
      similarity: ev.similarity,
      evidenceType: ev.evidence_type,
      sharedWithTwin: sharedIds.has(ev.item.id),
    })
  }

  for (const item of twinShared) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    rows.push({
      key: `shared-${item.id}`,
      id: item.id,
      title: item.title,
      year: item.year,
      poster_url: item.poster_url,
      similarity: item.similarity,
      evidenceType: null,
      sharedWithTwin: true,
    })
  }

  // Array.prototype.sort is stable, so equal similarities keep insertion order.
  return rows.sort((a, b) => {
    if (a.similarity == null && b.similarity == null) return 0
    if (a.similarity == null) return 1
    if (b.similarity == null) return -1
    return b.similarity - a.similarity
  })
}
