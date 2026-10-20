import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTION_TYPES,
  edgeColorType,
  edgeIsLit,
  litNodeIds,
  primaryConnectionType,
} from './connectionHighlight'
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
