import test from 'node:test'
import assert from 'node:assert/strict'
import { parseModelJson, repairModelJsonEscapes } from './modelJson.js'

test("a JavaScript-style \\' inside a string reads as an apostrophe", () => {
  assert.deepEqual(parseModelJson(String.raw`{"reason":"Mann\'s best"}`), { reason: "Mann's best" })
})

test('any other stray backslash is kept as a literal backslash', () => {
  assert.deepEqual(parseModelJson(String.raw`{"path":"C:\drive"}`), { path: String.raw`C:\drive` })
})

test('valid escapes, an escaped backslash before an apostrophe included, are left alone', () => {
  const text = String.raw`{"a":"line\nbreak \"quoted\" \u00e9 back\\'slash \/"}`
  assert.equal(repairModelJsonEscapes(text), text)
  assert.deepEqual(parseModelJson(text), { a: 'line\nbreak "quoted" \u00e9 back\\\'slash /' })
})

test('nothing outside a string body is rewritten', () => {
  assert.equal(repairModelJsonEscapes(String.raw`[1, \' 2]`), String.raw`[1, \' 2]`)
})

test('valid JSON parses without the repair, and an unreadable document still throws', () => {
  assert.deepEqual(parseModelJson('[{"x":1}]'), [{ x: 1 }])
  assert.throws(() => parseModelJson('{"explanations":[{"index":1,"explanation":"cut off'), SyntaxError)
  assert.throws(() => parseModelJson(String.raw`{"a":"don\'t", "b": }`), SyntaxError)
})
