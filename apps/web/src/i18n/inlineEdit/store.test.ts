import { test } from 'node:test'
import assert from 'node:assert/strict'
import i18n from 'i18next'
import { REFRESH_EVENT, applyLiveString, getTextIndex, inlineEditPostProcessor, setInlineEditEnabled } from './store'

// The store drives the shared i18next instance, as the app does; this pins
// the two things it relies on i18next for and cannot see from a type: the
// post-processor can be switched on after init, and it is handed the key that
// actually resolved.
test('switching on after init records each string under its resolved key, and switching off stops it', async () => {
  await i18n.use(inlineEditPostProcessor).init({
    lng: 'en',
    resources: {
      en: { translation: { greet: 'Hello {{name}}', items_one: '{{count}} item', items_other: '{{count}} items' } },
    },
    interpolation: { escapeValue: false },
  })
  let refreshes = 0
  i18n.on(REFRESH_EVENT, () => {
    refreshes += 1
  })

  i18n.t('greet', { name: 'Ada' })
  assert.equal(getTextIndex().size, 0, 'nothing is recorded while off')

  setInlineEditEnabled(true)
  assert.equal(refreshes, 1, 'switching on re-renders translated components')
  i18n.t('greet', { name: 'Ada' })
  i18n.t('items', { count: 1 })
  i18n.t('items', { count: 3 })
  i18n.t('missing.key')
  assert.deepEqual(getTextIndex().lookup('Hello Ada').map((m) => m.key), ['greet'])
  assert.deepEqual(getTextIndex().lookup('3 items').map((m) => m.key), ['items_other'])
  assert.deepEqual(getTextIndex().lookup('1 item').map((m) => m.key), ['items_one'])
  assert.deepEqual(getTextIndex().lookup('missing.key'), [], 'a missing key has nothing to edit')

  // An explicit empty postProcess (the editor's own chrome) is not recorded.
  getTextIndex().clear()
  i18n.t('greet', { name: 'Bo', postProcess: [] })
  assert.equal(getTextIndex().size, 0)

  applyLiveString('en', 'greet', 'Hi {{name}}')
  assert.equal(i18n.t('greet', { name: 'Ada' }), 'Hi Ada')

  setInlineEditEnabled(false)
  i18n.t('greet', { name: 'Ada' })
  assert.equal(getTextIndex().size, 0)
  assert.equal(i18n.options.postProcess, false)
})
