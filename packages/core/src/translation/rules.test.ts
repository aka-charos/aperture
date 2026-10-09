import { test } from 'node:test'
import assert from 'node:assert/strict'

import { APP_LOCALE_OPTIONS } from '../lib/locales.js'
import {
  DEFAULT_TRANSLATION_CONFIG,
  ECHO_CHECK_MIN_CHARS,
  INDEX_TRANSLATE_BASE_URL,
  buildChatCompletionBody,
  buildIndexTranslatePrompt,
  chatCompletionsUrl,
  enabledFields,
  maxTokensFor,
  modelsUrl,
  readCompletion,
  readModelList,
  resolveTargetLanguages,
  sanitizeTranslationConfig,
  stripThink,
} from './rules.js'

// ---------------------------------------------------------------- prompt

test('the plain Index-Translate prompt is call_api.py build_prompt, byte for byte', () => {
  // build_prompt(text, "ell_grek"→希腊语, source "en"→英语) with no glossary or
  // instruction: the only form the free API's README shows.
  assert.equal(
    buildIndexTranslatePrompt('  A heist goes wrong.  ', 'el', 'en'),
    '请将以下英语文本翻译为希腊语，直接输出翻译结果，不要进行任何解释。\n\nA heist goes wrong.'
  )
})

test('an instruction switches to the instTrans constraint form, one 【注意】 per line', () => {
  const prompt = buildIndexTranslatePrompt('Text.', 'de', 'en', '1. keep names\n【硬性要求】no notes\n\n')
  assert.equal(
    prompt,
    '请将以下英语文本翻译成德语，并且严格遵循所有约束要求。\n\n' +
      '【源文】\nText.\n\n' +
      '【约束要求】\n1. 【注意】keep names\n2. 【硬性要求】no notes\n\n' +
      '只输出译文，不要有任何额外说明。'
  )
})

test('every app locale is named in Chinese, never sent as a bare code', () => {
  for (const { code } of APP_LOCALE_OPTIONS) {
    const prompt = buildIndexTranslatePrompt('x', code, 'en')
    assert.doesNotMatch(prompt, new RegExp(`翻译为${code}，`), code)
    assert.match(prompt, /翻译为\p{Script=Han}+，/u, code)
  }
})

test('Index-Translate bodies switch reasoning off; instruction bodies send no unknown field', () => {
  const it = buildChatCompletionBody({ ...DEFAULT_TRANSLATION_CONFIG }, 'Hello there.', 'el', 'en')
  assert.deepEqual(it.chat_template_kwargs, { enable_thinking: false })
  assert.equal(it.temperature, 0)
  assert.equal(it.messages.length, 1)
  assert.equal(it.messages[0].role, 'user')

  const generic = buildChatCompletionBody(
    { ...DEFAULT_TRANSLATION_CONFIG, promptStyle: 'instruction', model: 'qwen' },
    'Hello there.',
    'el',
    'en'
  )
  assert.equal('chat_template_kwargs' in generic, false)
  assert.equal(generic.messages[0].role, 'system')
  assert.match(generic.messages[0].content, /from English into Greek/)
  assert.equal(generic.messages[1].content, 'Hello there.')
})

test('the output allowance outgrows the official 1024 for a long synopsis, and is capped', () => {
  assert.equal(maxTokensFor('short'), 1024)
  assert.ok(maxTokensFor('x'.repeat(4000)) > 1024)
  assert.equal(maxTokensFor('x'.repeat(100_000)), 8192)
})

// ---------------------------------------------------------------- reading

const answer = (content: unknown, finish_reason = 'stop') => ({
  choices: [{ message: { content }, finish_reason }],
})

test('a good answer is read and a leaked reasoning block is stripped', () => {
  assert.deepEqual(readCompletion(answer('<think>hmm</think>\n Μια ληστεία. '), 'A heist.'), {
    ok: true,
    text: 'Μια ληστεία.',
  })
  assert.equal(stripThink('<think>only'), 'only')
})

test('a truncated answer is refused even though it has text', () => {
  const r = readCompletion(answer('Μια ληστεία που', 'length'), 'A heist that goes wrong.')
  assert.equal(r.ok, false)
})

test('an echo of a sentence is refused — it would be stored as the translation', () => {
  const source = 'A heist goes wrong and the crew scatters across Marseille.'
  assert.ok(source.length >= ECHO_CHECK_MIN_CHARS)
  const r = readCompletion(answer(`  ${source.toUpperCase()}   `), source)
  assert.equal(r.ok, false)
})

test('a short source that is the same in both languages is accepted, not retried forever', () => {
  assert.deepEqual(readCompletion(answer('TBA'), 'TBA'), { ok: true, text: 'TBA' })
})

test('empty, missing and malformed answers are refused, never stored', () => {
  assert.equal(readCompletion(answer('   '), 'x').ok, false)
  assert.equal(readCompletion(answer(null), 'x').ok, false)
  assert.equal(readCompletion({}, 'x').ok, false)
  assert.equal(readCompletion(null, 'x').ok, false)
})

test('a model listing is read leniently', () => {
  assert.deepEqual(readModelList({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, {}] }), ['a', 'b'])
  assert.deepEqual(readModelList({ nope: true }), [])
})

// ---------------------------------------------------------------- endpoint

test('any pasted form of the base URL reaches /v1/chat/completions exactly once', () => {
  const want = 'https://index-translate.bilibili.com/v1/chat/completions'
  for (const pasted of [
    INDEX_TRANSLATE_BASE_URL,
    `${INDEX_TRANSLATE_BASE_URL}/`,
    'https://index-translate.bilibili.com',
    `${INDEX_TRANSLATE_BASE_URL}/chat/completions`,
  ]) {
    assert.equal(chatCompletionsUrl(pasted), want, pasted)
  }
  assert.equal(modelsUrl('http://host.docker.internal:1234'), 'http://host.docker.internal:1234/v1/models')
  // A path that is not /vN is the root as given: appending /v1 would 404.
  assert.equal(
    chatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai/'),
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  )
  assert.equal(chatCompletionsUrl('https://api.z.ai/api/paas/v4'), 'https://api.z.ai/api/paas/v4/chat/completions')
  assert.equal(chatCompletionsUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(chatCompletionsUrl('index-translate.bilibili.com'), null)
  assert.equal(chatCompletionsUrl(''), null)
})

// ---------------------------------------------------------------- config

test('an empty store reads as the free endpoint, switched off, both fields on', () => {
  const c = sanitizeTranslationConfig(undefined)
  assert.equal(c.enabled, false)
  assert.equal(c.baseUrl, INDEX_TRANSLATE_BASE_URL)
  assert.deepEqual(enabledFields(c), ['overview', 'plot_full'])
  assert.equal(c.targetLanguages, null)
})

test('absent knobs take defaults; present ones clamp; Number(null) is not a value', () => {
  const c = sanitizeTranslationConfig({
    timeoutMs: null as unknown as number,
    callSpacingSeconds: 9999,
    baseUrl: '   ',
    model: '',
    promptStyle: 'nonsense' as never,
    sourceLanguage: 'xx' as never,
  })
  assert.equal(c.timeoutMs, DEFAULT_TRANSLATION_CONFIG.timeoutMs)
  assert.equal(c.callSpacingSeconds, 120)
  assert.equal(c.baseUrl, INDEX_TRANSLATE_BASE_URL)
  assert.equal(c.model, DEFAULT_TRANSLATION_CONFIG.model)
  assert.equal(c.promptStyle, 'index-translate')
  assert.equal(c.sourceLanguage, 'en')
})

test('a stored field switched off stays off; invalid target codes are dropped', () => {
  const c = sanitizeTranslationConfig({
    fields: { overview: true, plot_full: false },
    targetLanguages: ['el', 'zz', 'el', 'de'] as never,
  })
  assert.deepEqual(enabledFields(c), ['overview'])
  assert.deepEqual(c.targetLanguages, ['el', 'de'])
})

// ---------------------------------------------------------------- targets

test('targets follow the enabled UI languages, never the source, in app order', () => {
  // The operator's setup: English and Greek enabled.
  assert.deepEqual(
    resolveTargetLanguages({ targetLanguages: null, sourceLanguage: 'en' }, ['el', 'en']),
    ['el']
  )
})

test('a stored target the interface no longer offers is not translated into', () => {
  assert.deepEqual(
    resolveTargetLanguages({ targetLanguages: ['el', 'de'], sourceLanguage: 'en' }, ['en', 'el']),
    ['el']
  )
})

test('an explicit empty list means none, not "follow the interface"', () => {
  assert.deepEqual(
    resolveTargetLanguages({ targetLanguages: [], sourceLanguage: 'en' }, ['en', 'el', 'de']),
    []
  )
})
