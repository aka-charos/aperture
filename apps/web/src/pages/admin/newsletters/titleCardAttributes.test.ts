import { test } from 'node:test'
import assert from 'node:assert/strict'

import { titleCardAttributes, type AttributeSource } from './titleCardAttributes'

type Spec = {
  default: unknown
  parseHTML: (element: AttributeSource) => unknown
  renderHTML: (attributes: Record<string, unknown>) => Record<string, string>
}

/**
 * Render every attribute to HTML attributes, then parse them back, as a copy
 * and paste does. The source lowercases names, as the DOM does.
 */
function roundTrip(attrs: Record<string, unknown>): Record<string, unknown> {
  const specs = titleCardAttributes() as unknown as Record<string, Spec>
  const html: Record<string, string> = {}
  for (const spec of Object.values(specs)) {
    for (const [name, value] of Object.entries(spec.renderHTML(attrs))) html[name.toLowerCase()] = value
  }
  const element: AttributeSource = { getAttribute: (name) => html[name.toLowerCase()] ?? null }
  return Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.parseHTML(element)]))
}

test('a title card survives copy and paste with its lists still lists', () => {
  const attrs = {
    mediaType: 'series',
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Dark, "the" series',
    year: 2017,
    posterUrl: 'http://emby:8096/Items/1/Images/Primary?tag=a&b=c',
    fields: ['poster', 'analysis'],
    analysisParts: ['tradition', 'structure'],
  }
  assert.deepEqual(roundTrip(attrs), attrs)
})

test('missing or malformed attributes read as their defaults, never as strings', () => {
  const specs = titleCardAttributes() as unknown as Record<string, Spec>
  const broken: AttributeSource = {
    getAttribute: (name) => ({ 'data-fields': 'poster,year', 'data-year': 'soon' })[name] ?? null,
  }
  assert.deepEqual(specs.fields!.parseHTML(broken), [])
  assert.deepEqual(specs.analysisParts!.parseHTML(broken), [])
  assert.equal(specs.year!.parseHTML(broken), null)
  assert.equal(specs.mediaType!.parseHTML(broken), 'movie')
})
