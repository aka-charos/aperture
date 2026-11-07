import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heroTitleInCondensedFace } from './heroTitle'

test('a title in Latin letters, accents, digits and punctuation takes the condensed face', () => {
  for (const title of ['Heat', 'Amélie', 'Blade Runner 2049', 'Se7en: Director’s Cut', '12 Angry Men', '1917']) {
    assert.equal(heroTitleInCondensedFace(title), true, title)
  }
})

test('a title with any letter the face cannot draw keeps the reading face', () => {
  for (const title of ['Ο Θίασος', '千と千尋の神隠し', 'Сталкер', 'Z: Ζ', 'Oldboy 올드보이']) {
    assert.equal(heroTitleInCondensedFace(title), false, title)
  }
})
