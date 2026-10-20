import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navigationClosesDialog } from './mediaDetailNavigation'

const trails = { pathname: '/trails', search: '?mode=route' }

test('moving to another page closes the dialog, however it got there', () => {
  for (const kind of ['PUSH', 'REPLACE', 'POP'] as const) {
    assert.equal(navigationClosesDialog(trails, { pathname: '/person/x', search: '' }, kind), true)
  }
})

test('a link to the same page with other parameters closes it', () => {
  assert.equal(navigationClosesDialog(trails, { pathname: '/trails', search: '?mode=threads' }, 'PUSH'), true)
  assert.equal(navigationClosesDialog(trails, { pathname: '/trails', search: '?mode=threads' }, 'POP'), true)
})

test('a page writing its own state back in place does not close it', () => {
  assert.equal(navigationClosesDialog(trails, { pathname: '/trails', search: '?mode=common' }, 'REPLACE'), false)
})

test('nothing changed, nothing closes', () => {
  assert.equal(navigationClosesDialog(trails, { ...trails }, 'PUSH'), false)
})
