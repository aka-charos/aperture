import type { TFunction } from 'i18next'
import { formatDurationMs } from '../../lib/formatDuration'

/**
 * What produced the stored row: which model wrote it, which retrieval mode fed
 * it, how much text that came to, how long it took. Sent to admins only, so the
 * panel renders it whenever it is present rather than re-deciding who may see it.
 */
export interface AnalysisProvenance {
  model: string | null
  retrievalMode: 'crw' | 'grounding' | null
  sourceCount: number | null
  retrievedChars: number | null
  promptVersion: number
  /** Null when no separate fetching was timed: grounding mode, offsite imports, older rows. */
  retrievalMs?: number | null
  /** Pacing waits excluded. Null on older rows and offsite results that don't say. */
  writeMs?: number | null
}

/** A total only when both phases were timed; otherwise the writing, named as such. */
function describeTime(p: AnalysisProvenance, t: TFunction): string | null {
  if (p.writeMs == null) return null
  const writing = formatDurationMs(p.writeMs, t)
  if (p.retrievalMs == null) return t('mediaDetail.analysis.admin.writingTime', { writing })
  return t('mediaDetail.analysis.admin.timeTaken', {
    total: formatDurationMs(p.retrievalMs + p.writeMs, t),
    writing,
  })
}

/**
 * One line saying what wrote this row. Every part is optional: rows written
 * before a column existed carry nulls, and a gap has to read as "not recorded"
 * rather than as a broken panel.
 */
export function describeProvenance(
  data: { provenance?: AnalysisProvenance; analyzedAt?: string },
  t: TFunction
): string | null {
  const p = data.provenance
  if (!p) return null
  const parts: string[] = []
  if (p.model) parts.push(p.model)
  if (p.retrievalMode) parts.push(t(`mediaDetail.analysis.admin.mode.${p.retrievalMode}`))
  if (p.sourceCount != null) {
    parts.push(t('mediaDetail.analysis.admin.sourceCount', { count: p.sourceCount }))
  }
  if (p.retrievedChars != null) {
    parts.push(
      t('mediaDetail.analysis.admin.retrievedChars', { chars: p.retrievedChars.toLocaleString() })
    )
  }
  parts.push(t('mediaDetail.analysis.admin.promptVersion', { version: p.promptVersion }))
  const time = describeTime(p, t)
  if (time) parts.push(time)
  if (data.analyzedAt) parts.push(new Date(data.analyzedAt).toLocaleString())
  return parts.join(' · ')
}
