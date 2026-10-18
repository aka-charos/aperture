import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_IMAGE_WIDTHS, defaultWidthFor, withDefaultImageSize } from './imageSize.js'

test('a poster with only a cache tag gets a width', () => {
  assert.equal(
    withDefaultImageSize('Items/779147/Images/Primary', '?tag=bdd0e46b'),
    `?tag=bdd0e46b&maxWidth=${DEFAULT_IMAGE_WIDTHS.itemPrimary}`
  )
})

test('a poster with no query string gets one', () => {
  assert.equal(
    withDefaultImageSize('Items/1/Images/Primary', ''),
    `?maxWidth=${DEFAULT_IMAGE_WIDTHS.itemPrimary}`
  )
})

test('a size the caller chose is never overridden, in any case or spelling', () => {
  for (const q of ['?maxWidth=300', '?maxheight=200', '?fillWidth=100&fillHeight=150', '?tag=x&Width=50']) {
    assert.equal(withDefaultImageSize('Items/1/Images/Primary', q), q)
  }
})

test('each kind gets its own width; other kinds are left alone', () => {
  assert.equal(defaultWidthFor('Items/1/Images/Backdrop'), DEFAULT_IMAGE_WIDTHS.backdrop)
  assert.equal(defaultWidthFor('Items/1/Images/Backdrop/2'), DEFAULT_IMAGE_WIDTHS.backdrop)
  assert.equal(defaultWidthFor('Items/1/Images/Thumb'), DEFAULT_IMAGE_WIDTHS.thumb)
  assert.equal(defaultWidthFor('Persons/Geoffrey%20Rush/Images/Primary'), DEFAULT_IMAGE_WIDTHS.person)
  assert.equal(defaultWidthFor('items/1/images/primary'), DEFAULT_IMAGE_WIDTHS.itemPrimary)
  assert.equal(defaultWidthFor('Items/1/Images/Logo'), null)
  assert.equal(defaultWidthFor('Users/abc/Images/Primary'), null)
  assert.equal(withDefaultImageSize('Items/1/Images/Logo', '?tag=x'), '?tag=x')
})
