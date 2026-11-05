import { test } from 'node:test'
import assert from 'node:assert/strict'
import i18n, { firstLanguageReady } from '@/i18n/config'
import { loadTmdbGenreNames } from './genreLabel'

/** Answers the genre route with one name and counts how often it was asked. */
function stubGenreRoute() {
  const asked: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (!url.includes('/api/title-translations/genres')) return new Response('{}', { status: 404 })
    asked.push(url)
    return new Response(JSON.stringify({ names: { Drama: 'Δράμα TMDb' } }), { status: 200 })
  }) as typeof fetch
  return asked
}

test('names answering before the language strings wait for them instead of being dropped', async () => {
  stubGenreRoute()
  await firstLanguageReady()
  assert.equal(i18n.hasResourceBundle('el', 'translation'), false, 'the language has not arrived yet')

  await loadTmdbGenreNames('el')

  assert.equal(i18n.getResource('el', 'translation', 'genresTmdb.drama'), 'Δράμα TMDb')
  assert.ok(i18n.getResource('el', 'translation', 'nav'), 'and the whole file came, not just these names')
})

test('names that could not go in are not remembered as loaded', async () => {
  const asked = stubGenreRoute()
  await firstLanguageReady()

  await loadTmdbGenreNames('xx')
  await loadTmdbGenreNames('xx')

  assert.equal(asked.length, 2)
  assert.equal(i18n.hasResourceBundle('xx', 'translation'), false)
})
