import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRepliesTarget, draftWithReply, type ThreadMessageLike } from './nextRepliesTarget'

const question: ThreadMessageLike = { id: 'q', role: 'user', content: [{ type: 'text', text: 'Films like Heat' }] }
const answer = (status: string, content: ThreadMessageLike['content']): ThreadMessageLike => ({
  id: 'a',
  role: 'assistant',
  status: { type: status },
  content,
})

test('a finished answer gets suggestions; its prose or its cards are enough', () => {
  assert.equal(nextRepliesTarget([question, answer('complete', [{ type: 'text', text: 'Try Thief.' }])], false), 'a')
  assert.equal(nextRepliesTarget([question, answer('complete', [{ type: 'tool-call' }])], false), 'a')
})

test('nothing while writing, after Stop or an error, or for an empty answer', () => {
  const done = answer('complete', [{ type: 'text', text: 'Try Thief.' }])
  assert.equal(nextRepliesTarget([question, done], true), null)
  assert.equal(nextRepliesTarget([question, answer('incomplete', [{ type: 'text', text: 'Try' }])], false), null)
  assert.equal(nextRepliesTarget([question, answer('running', [])], false), null)
  assert.equal(nextRepliesTarget([question, answer('complete', [{ type: 'text', text: '  ' }])], false), null)
})

test('nothing when the newest message is the question, or the runtime is empty', () => {
  assert.equal(nextRepliesTarget([question], false), null)
  assert.equal(nextRepliesTarget([], false), null)
})

test('a tap fills an empty box, swaps an untouched suggestion, and keeps a typed draft', () => {
  const shown = ['Why Thief?', 'Only films under two hours']
  assert.equal(draftWithReply('', 'Why Thief?', shown), 'Why Thief?')
  assert.equal(draftWithReply('  \n', 'Why Thief?', shown), 'Why Thief?')
  assert.equal(draftWithReply('Why Thief?', 'Only films under two hours', shown), 'Only films under two hours')
  assert.equal(
    draftWithReply('Something darker, and', 'Only films under two hours', shown),
    'Something darker, and\nOnly films under two hours'
  )
  // An edited suggestion is the reader's draft now.
  assert.equal(draftWithReply('Why Thief? And Heat?', 'Why Thief?', shown), 'Why Thief? And Heat?\nWhy Thief?')
})
