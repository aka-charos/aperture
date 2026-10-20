import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTION_TYPES,
  filterGraphByConnectionTypes,
  parseHiddenConnectionTypes,
  primaryConnectionType,
} from './connectionFilter'
import type { GraphData } from './types'

function graph(): GraphData {
  return {
    nodes: [
      { id: 'c', title: 'Center', year: 2000, poster_url: null, type: 'movie', isCenter: true },
      { id: 'a', title: 'A', year: 2001, poster_url: null, type: 'movie', isCenter: false },
      { id: 'b', title: 'B', year: 2002, poster_url: null, type: 'movie', isCenter: false },
      { id: 'd', title: 'D', year: 2003, poster_url: null, type: 'movie', isCenter: false },
    ],
    edges: [
      { source: 'c', target: 'a', similarity: 0.8, reasons: [{ type: 'director', value: 'X' }, { type: 'genre', values: ['Drama'] }] },
      { source: 'c', target: 'b', similarity: 0.7, reasons: [{ type: 'genre', values: ['Drama'] }] },
      { source: 'a', target: 'd', similarity: 0.6, reasons: [{ type: 'similarity' }] },
    ],
  }
}

test('nothing hidden returns the same data, so the graph does not re-lay itself out', () => {
  const data = graph()
  assert.equal(filterGraphByConnectionTypes(data, new Set()), data)
})

test('an edge keeps only its shown reasons and goes when none is left', () => {
  const result = filterGraphByConnectionTypes(graph(), new Set(['genre']))
  assert.deepEqual(
    result.edges.map((edge) => [edge.source, edge.target, edge.reasons.map((r) => r.type)]),
    [
      ['c', 'a', ['director']],
      ['a', 'd', ['similarity']],
    ]
  )
})

test('a node no edge touches any more goes, a centre always stays', () => {
  const result = filterGraphByConnectionTypes(graph(), new Set(['genre', 'similarity', 'director']))
  assert.deepEqual(result.nodes.map((node) => node.id), ['c'])
  assert.deepEqual(result.edges, [])
})

test('ends become ids and the input is not modified', () => {
  const data = graph()
  const nodeA = data.nodes[1]
  data.edges[0].source = data.nodes[0]
  data.edges[0].target = nodeA
  const result = filterGraphByConnectionTypes(data, new Set(['similarity']))
  assert.equal(result.edges[0].source, 'c')
  assert.equal(result.edges[0].target, 'a')
  assert.equal(data.edges[0].reasons.length, 2)
  // Node objects are reused, so positions survive a toggle.
  assert.equal(result.nodes.find((node) => node.id === 'a'), nodeA)
})

test('the primary type is the strongest shown reason, and AI discovery is its own colour', () => {
  assert.equal(primaryConnectionType([{ type: 'genre' }, { type: 'director' }]), 'director')
  assert.equal(primaryConnectionType([{ type: 'ai_diverse' }]), 'ai_diverse')
  assert.equal(primaryConnectionType([]), 'similarity')
})

test('a stored list keeps known types only, and anything unreadable shows everything', () => {
  assert.deepEqual(parseHiddenConnectionTypes('["genre","bogus","actor"]'), ['actor', 'genre'])
  assert.deepEqual(parseHiddenConnectionTypes('not json'), [])
  assert.deepEqual(parseHiddenConnectionTypes('{"genre":true}'), [])
  assert.deepEqual(parseHiddenConnectionTypes(null), [])
  assert.equal(new Set(CONNECTION_TYPES).size, CONNECTION_TYPES.length)
})
