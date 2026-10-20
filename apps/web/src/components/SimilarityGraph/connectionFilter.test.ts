import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTION_TYPES,
  filterGraphByConnectionTypes,
  parseHiddenConnectionTypes,
  primaryConnectionType,
} from './connectionFilter'
import { CONNECTION_COLORS, type GraphData, type GraphNode } from './types'

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
  assert.deepEqual(result.nodes.map((n) => n.id), ['c', 'a', 'd'])
})

test('a cluster no centre reaches goes with its lines, though they are shown', () => {
  // c -genre- a -director- d: hiding genre leaves a-d drawn but cut off from c.
  const data: GraphData = {
    nodes: [node('c', true), node('a'), node('d')],
    edges: [
      { source: 'c', target: 'a', similarity: 0.7, reasons: [{ type: 'genre' }] },
      { source: 'a', target: 'd', similarity: 0.6, reasons: [{ type: 'director' }] },
    ],
  }
  const result = filterGraphByConnectionTypes(data, new Set(['genre']))
  assert.deepEqual(result.nodes.map((n) => n.id), ['c'])
  assert.deepEqual(result.edges, [])
})

test('reach walks lines either way and from every centre', () => {
  const data: GraphData = {
    nodes: [node('c1', true), node('c2', true), node('x'), node('y')],
    edges: [
      { source: 'x', target: 'c2', similarity: 0.7, reasons: [{ type: 'actor' }] },
      { source: 'y', target: 'x', similarity: 0.6, reasons: [{ type: 'actor' }] },
      { source: 'c1', target: 'y', similarity: 0.6, reasons: [{ type: 'genre' }] },
    ],
  }
  const result = filterGraphByConnectionTypes(data, new Set(['genre']))
  assert.deepEqual(result.nodes.map((n) => n.id), ['c1', 'c2', 'x', 'y'])
  assert.equal(result.edges.length, 2)
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
  assert.equal(result.nodes.find((n) => n.id === 'a'), nodeA)
})

test('the primary type follows core: AI discovery first, then the strongest shown reason', () => {
  assert.equal(primaryConnectionType([{ type: 'genre' }, { type: 'director' }]), 'director')
  assert.equal(primaryConnectionType([{ type: 'collection' }, { type: 'ai_diverse' }]), 'ai_diverse')
  assert.equal(primaryConnectionType([]), 'similarity')
})

test('every colour is a legend entry, so every drawn type can be filtered', () => {
  assert.deepEqual([...CONNECTION_TYPES].sort(), Object.keys(CONNECTION_COLORS).sort())
})

test('a stored list keeps known types only, and anything unreadable shows everything', () => {
  assert.deepEqual(parseHiddenConnectionTypes('["genre","bogus","actor"]'), ['actor', 'genre'])
  assert.deepEqual(parseHiddenConnectionTypes('not json'), [])
  assert.deepEqual(parseHiddenConnectionTypes('{"genre":true}'), [])
  assert.deepEqual(parseHiddenConnectionTypes(null), [])
})

test('a stored list hiding every type reads as nothing hidden', () => {
  assert.deepEqual(parseHiddenConnectionTypes(JSON.stringify(CONNECTION_TYPES)), [])
})
