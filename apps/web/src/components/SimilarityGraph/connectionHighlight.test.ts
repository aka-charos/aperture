import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTION_TYPES,
  edgeColorType,
  edgeIsLit,
  effectiveHighlight,
  legendConnectionTypes,
  litNodeIds,
  primaryConnectionType,
  toggleHighlight,
} from './connectionHighlight'
import {
  readHighlightState,
  registerLegend,
  setHighlightPreview,
  toggleHighlightedType,
} from './connectionHighlightStore'
import { CONNECTION_COLORS, type ConnectionType, type GraphData, type GraphNode } from './types'

function node(id: string, isCenter = false): GraphNode {
  return { id, title: id, year: 2000, poster_url: null, type: 'movie', isCenter }
}

function graph(): GraphData {
  return {
    nodes: [node('c', true), node('a'), node('b'), node('d')],
    edges: [
      { source: 'c', target: 'a', similarity: 0.8, reasons: [{ type: 'director', value: 'X' }, { type: 'genre', values: ['Drama'] }] },
      { source: 'c', target: 'b', similarity: 0.7, reasons: [{ type: 'genre', values: ['Drama'] }] },
      { source: 'a', target: 'd', similarity: 0.6, reasons: [{ type: 'similarity' }] },
    ],
  }
}

const none = new Set<ConnectionType>()

test('nothing highlighted lights every line and every poster', () => {
  const data = graph()
  assert.ok(data.edges.every((edge) => edgeIsLit(edge.reasons, none)))
  assert.equal(litNodeIds(data.nodes, data.edges, none), null)
})

test('a highlight lights the lines carrying it and the posters they reach, centres always', () => {
  const data = graph()
  const director = new Set<ConnectionType>(['director'])
  assert.deepEqual(data.edges.map((edge) => edgeIsLit(edge.reasons, director)), [true, false, false])
  assert.deepEqual([...(litNodeIds(data.nodes, data.edges, director) ?? [])].sort(), ['a', 'c'])
})

test('a highlight nothing carries still keeps the centres as a landmark', () => {
  const data = graph()
  assert.deepEqual([...(litNodeIds(data.nodes, data.edges, new Set(['network'])) ?? [])], ['c'])
})

test('ends given as node objects (after the simulation ran) are read as ids', () => {
  const data = graph()
  data.edges[0].source = data.nodes[0]
  data.edges[0].target = data.nodes[1]
  assert.deepEqual([...(litNodeIds(data.nodes, data.edges, new Set(['director'])) ?? [])].sort(), ['a', 'c'])
})

test('a lit line takes the colour of the highlighted reason it carries', () => {
  const reasons = [{ type: 'director' as const }, { type: 'genre' as const }]
  assert.equal(edgeColorType(reasons, none), 'director')
  assert.equal(edgeColorType(reasons, new Set(['genre'])), 'genre')
  // A dimmed line keeps its own colour.
  assert.equal(edgeColorType(reasons, new Set(['network'])), 'director')
})

test('the primary type follows core: AI discovery first, then the strongest reason', () => {
  assert.equal(primaryConnectionType([{ type: 'genre' }, { type: 'director' }]), 'director')
  assert.equal(primaryConnectionType([{ type: 'collection' }, { type: 'ai_diverse' }]), 'ai_diverse')
  assert.equal(primaryConnectionType([]), 'similarity')
})

test('every colour is a legend entry, so every drawn type can be highlighted', () => {
  assert.deepEqual([...CONNECTION_TYPES].sort(), Object.keys(CONNECTION_COLORS).sort())
})

test('toggling adds and removes a type and leaves the input alone', () => {
  const start = new Set<ConnectionType>(['genre'])
  const added = toggleHighlight(start, 'director')
  assert.deepEqual([...added].sort(), ['director', 'genre'])
  assert.deepEqual([...toggleHighlight(added, 'genre')], ['director'])
  assert.deepEqual([...start], ['genre'])
})

test('a preview stands in for the choice, and with none the choice itself comes back', () => {
  const chosen = new Set<ConnectionType>(['genre'])
  assert.deepEqual([...effectiveHighlight(chosen, 'actor')], ['actor'])
  // Same object, so a graph keyed on it does not restyle on every render.
  assert.equal(effectiveHighlight(chosen, null), chosen)
})

test('the highlight lasts while a legend is mounted and resets with the last one', () => {
  const first = registerLegend()
  const second = registerLegend()
  toggleHighlightedType('director')
  setHighlightPreview('genre')
  // One legend going clears the preview it can no longer clear itself.
  first()
  assert.equal(readHighlightState().preview, null)
  assert.deepEqual([...readHighlightState().highlighted], ['director'])
  // The last one going leaves nothing behind for the next page's graph.
  second()
  assert.equal(readHighlightState().highlighted.size, 0)
})

test('a legend lists only the types its graph carries, in legend order', () => {
  // director and genre are reasons, similarity rides on the a-d edge.
  assert.deepEqual(legendConnectionTypes(graph().edges, new Set()), ['director', 'genre', 'similarity'])
  // A secondary reason counts: highlighting it lights that edge.
  const edges = [{ source: 'c', target: 'a', similarity: 0.8, reasons: [{ type: 'collection' as const }, { type: 'actor' as const }] }]
  assert.deepEqual(legendConnectionTypes(edges, new Set()), ['actor', 'collection'])
})

test('an edge with no reasons lists the type it is drawn in', () => {
  const edges = [{ source: 'c', target: 'a', similarity: 0.8, reasons: [] }]
  assert.deepEqual(legendConnectionTypes(edges, new Set()), ['similarity'])
})

test('a chosen type the graph lacks stays listed so it can be undone', () => {
  assert.deepEqual(legendConnectionTypes(graph().edges, new Set<ConnectionType>(['network'])), [
    'director',
    'genre',
    'network',
    'similarity',
  ])
})

test('no graph lists nothing', () => {
  assert.deepEqual(legendConnectionTypes(null, new Set()), [])
  assert.deepEqual(legendConnectionTypes(undefined, new Set()), [])
  assert.deepEqual(legendConnectionTypes([], new Set()), [])
})
