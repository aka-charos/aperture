/**
 * How each title-card attribute survives HTML. Pure (no DOM, no editor), so a
 * test can pin it: copy and paste go through HTML, and an attribute left to
 * TipTap's default comes back as the string its HTML attribute held, which
 * turned `fields` into "poster,year" and crashed the card on paste.
 */

/** The one thing parsing reads off an element. */
export interface AttributeSource {
  getAttribute(name: string): string | null
}

type Attributes = Record<string, unknown>

/** A JSON list of strings in a data attribute; anything else reads as `fallback`. */
function stringList(name: string, key: string, fallback: string[]) {
  return {
    default: fallback,
    parseHTML: (element: AttributeSource): string[] => {
      const raw = element.getAttribute(name)
      if (raw == null) return fallback
      try {
        const value: unknown = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback
      } catch {
        return fallback
      }
    },
    renderHTML: (attributes: Attributes) => ({
      [name]: JSON.stringify(Array.isArray(attributes[key]) ? attributes[key] : fallback),
    }),
  }
}

export function titleCardAttributes() {
  // HTML attribute names are case-insensitive, so camelCase keys become kebab-case.
  const html = (name: string) => `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  const text = (name: string, fallback: string | null) => ({
    default: fallback,
    parseHTML: (element: AttributeSource) => element.getAttribute(html(name)) ?? fallback,
    renderHTML: (attributes: Attributes) =>
      attributes[name] == null ? {} : { [html(name)]: String(attributes[name]) },
  })
  return {
    mediaType: {
      ...text('mediaType', 'movie'),
      parseHTML: (element: AttributeSource) => (element.getAttribute('data-media-type') === 'series' ? 'series' : 'movie'),
    },
    id: text('id', null),
    title: text('title', ''),
    posterUrl: text('posterUrl', null),
    year: {
      default: null,
      parseHTML: (element: AttributeSource) => {
        const year = Number.parseInt(element.getAttribute('data-year') ?? '', 10)
        return Number.isFinite(year) ? year : null
      },
      renderHTML: (attributes: Attributes) =>
        attributes.year == null ? {} : { 'data-year': String(attributes.year) },
    },
    analysisParts: stringList('data-analysis-parts', 'analysisParts', []),
    fields: stringList('data-fields', 'fields', []),
  }
}
