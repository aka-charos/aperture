/*
 * The field list, the default fields and the analysis parts are all decided by
 * the server (`/api/newsletters/options`); the editor waits for them rather
 * than carrying a copy that drifts the first time core changes its list.
 */

export interface TitleCardAttrs {
  mediaType: 'movie' | 'series'
  id: string
  /** Shown in the editor only; the email reads the title fresh at send time. */
  title: string
  year: number | null
  posterUrl: string | null
  fields: string[]
  /** Which parts of the film analysis to show; empty shows all of it (as the server reads it). */
  analysisParts: string[]
}

/** The translation key for a field's label; a show's director is its creator. */
export function fieldLabelKey(field: string, mediaType: 'movie' | 'series'): string {
  return `newsletters.fields.${field}${field === 'director' && mediaType === 'series' ? 'Series' : ''}`
}
