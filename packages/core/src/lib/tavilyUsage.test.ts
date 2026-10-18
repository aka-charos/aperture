import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTavilyUsage } from './tavilyUsage.js'

describe('parseTavilyUsage', () => {
  it('reads the documented shape', () => {
    const usage = parseTavilyUsage({
      key: { usage: 150, limit: 1000, search_usage: 150 },
      account: {
        current_plan: 'Researcher',
        plan_usage: 500,
        plan_limit: 1000,
        paygo_usage: 0,
        paygo_limit: 0,
      },
    })
    assert.deepEqual(usage, {
      key: { used: 150, limit: 1000 },
      account: {
        plan: 'Researcher',
        planCredits: { used: 500, limit: 1000 },
        payAsYouGo: { used: 0, limit: 0 },
      },
    })
  })

  it('keeps a real zero and turns a missing figure into null, never 0', () => {
    const usage = parseTavilyUsage({ key: { usage: 0, limit: null }, account: { plan_usage: '12' } })
    assert.deepEqual(usage.key, { used: 0, limit: null })
    assert.deepEqual(usage.account?.planCredits, { used: null, limit: null })
    assert.equal(usage.account?.plan, null)
  })

  it('reports an empty or malformed answer as empty rather than throwing', () => {
    assert.deepEqual(parseTavilyUsage({}), { key: null, account: null })
    assert.deepEqual(parseTavilyUsage(null), { key: null, account: null })
    assert.deepEqual(parseTavilyUsage('nope'), { key: null, account: null })
    assert.deepEqual(parseTavilyUsage({ key: [1, 2], account: 'x' }), { key: null, account: null })
  })
})
