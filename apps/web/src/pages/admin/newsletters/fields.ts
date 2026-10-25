/**
 * Field order and the default set come from the API (`/api/newsletters/options`);
 * this copy is only what a card falls back to before that answers, and the
 * server reads every stored list against its own (core newsletter/document.ts).
 */
export const FALLBACK_TITLE_FIELDS = [
  'poster',
  'year',
  'runtime',
  'genres',
  'rating',
  'director',
  'cast',
  'network',
  'languages',
  'countries',
  'plot',
  'fullPlot',
  'analysis',
  'link',
]

/**
 * What a new card shows before the server's suggestion arrives. A module
 * constant on purpose: a fresh array each render would re-run every effect
 * that depends on it (the title picker resets itself on its default fields).
 */
export const FALLBACK_DEFAULT_FIELDS = ['poster', 'year', 'genres', 'plot', 'link']

export interface TitleCardAttrs {
  mediaType: 'movie' | 'series'
  id: string
  /** Shown in the editor only; the email reads the title fresh at send time. */
  title: string
  year: number | null
  posterUrl: string | null
  fields: string[]
}

/** The translation key for a field's label; a show's director is its creator. */
export function fieldLabelKey(field: string, mediaType: 'movie' | 'series'): string {
  return `newsletters.fields.${field}${field === 'director' && mediaType === 'series' ? 'Series' : ''}`
}
