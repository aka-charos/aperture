import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navigationClosesDialog } from './mediaDetailNavigation'

const next = { pathname: '/next', search: '?title=a' }

test('moving to another page closes the dialog, however it got there', () => {
  for (const kind of ['PUSH', 'REPLACE', 'POP'] as const) {
    assert.equal(navigationClosesDialog(next, { pathname: '/person/x', search: '' }, kind), true)
  }
})

test('a link to the same page with other parameters closes it', () => {
  assert.equal(navigationClosesDialog(next, { pathname: '/next', search: '?title=b' }, 'PUSH'), true)
  assert.equal(navigationClosesDialog(next, { pathname: '/next', search: '?title=b' }, 'POP'), true)
})

test('a page writing its own state back in place does not close it', () => {
  assert.equal(navigationClosesDialog(next, { pathname: '/next', search: '?title=a&view=map' }, 'REPLACE'), false)
})

test('nothing changed, nothing closes', () => {
  assert.equal(navigationClosesDialog(next, { ...next }, 'PUSH'), false)
})
