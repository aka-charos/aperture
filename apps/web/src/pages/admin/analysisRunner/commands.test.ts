import { test } from 'node:test'
import assert from 'node:assert/strict'
import { benchFileName, benchRunCommands, outstandingLabels, quoteRunnerArg } from './commands'

test('a plain model name stays bare and anything else is quoted', () => {
  assert.equal(quoteRunnerArg('qwen3-30b:a3b/q4_k.m'), 'qwen3-30b:a3b/q4_k.m')
  assert.equal(quoteRunnerArg('polystrata / some-model'), '"polystrata / some-model"')
  assert.equal(quoteRunnerArg('the "big" one'), '"the \\"big\\" one"')
})

test('only models still owing an answer are listed, once each, in run order', () => {
  const entries = [
    { model: 'gemma', status: 'pending' },
    { model: 'qwen', status: 'completed' },
    { model: 'llama', status: 'pending' },
    { model: 'gemma', status: 'pending' },
    { model: 'qwen', status: 'failed' },
  ]
  assert.deepEqual(outstandingLabels(entries), ['gemma', 'llama'])
})

test('every command names the file the panel downloads and its own model', () => {
  assert.deepEqual(benchRunCommands('runner.mjs', 'abc', ['gemma', 'my model']), [
    `node runner.mjs ${benchFileName('abc')} --label gemma --model <model id>`,
    `node runner.mjs ${benchFileName('abc')} --label "my model" --model <model id>`,
  ])
})

test('nobody owing an answer means no commands', () => {
  assert.deepEqual(benchRunCommands('runner.mjs', 'abc', []), [])
})
