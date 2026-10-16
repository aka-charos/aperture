import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addOutcome,
  describeTally,
  emptyTally,
  findEntityByName,
  LOGO_CHECK_DUE_SQL,
  LOGO_RECHECK_DAYS,
  normalizeEntityName,
  replacedLogoFile,
} from './studioLogoMatch.js'

const hbo = { id: 49, name: 'HBO', logo_path: '/hbo.png', origin_country: 'US' }
const hboFilms = { id: 7429, name: 'HBO Films', logo_path: '/films.png', origin_country: 'US' }

test('a near miss is not a match', () => {
  assert.equal(findEntityByName('HBO', [hboFilms]), null)
})

test('the exact name wins wherever it sits in the list', () => {
  assert.equal(findEntityByName('HBO', [hboFilms, hbo]), hbo)
})

test('case, accents and spacing do not matter', () => {
  assert.equal(normalizeEntityName('  Studio  Canal '), 'studio canal')
  assert.equal(normalizeEntityName('Télévision Française'), 'television francaise')
  assert.ok(findEntityByName('hbo', [hbo]))
})

test('an empty name or no candidates matches nothing', () => {
  assert.equal(findEntityByName('   ', [hbo]), null)
  assert.equal(findEntityByName('HBO', null), null)
  assert.equal(findEntityByName('HBO', []), null)
})

test('the tally counts every outcome once and its source separately', () => {
  const t = emptyTally()
  addOutcome(t, 'logo', 'title')
  addOutcome(t, 'noLogo', 'search')
  addOutcome(t, 'notFound', null)
  addOutcome(t, 'error', null)
  assert.deepEqual(t, {
    checked: 4,
    logo: 1,
    noLogo: 1,
    notFound: 1,
    error: 1,
    viaTitle: 1,
    viaSearch: 1,
    replaced: 0,
  })
  assert.match(describeTally('Networks', t), /4 checked — 1 logo stored, 1 on TMDb without a logo, 1 not found on TMDb, 1 failed/)
})

test('a match that ended in an error does not count as matched via anything', () => {
  const t = emptyTally()
  addOutcome(t, 'error', 'title')
  assert.equal(t.error, 1)
  assert.equal(t.viaTitle, 0)
  assert.match(describeTally('Studios', t), /0 matched: 0 via/)
})

test('replaced logos are reported only when there are some', () => {
  const t = emptyTally()
  assert.doesNotMatch(describeTally('Studios', t), /replaced/)
  t.replaced = 3
  assert.match(describeTally('Studios', t), /3 previously stored logos replaced or removed/)
})

test('the file a check leaves behind is the previous one, when it differs', () => {
  assert.equal(replacedLogoFile('studios/a.png', 'studios/a.svg'), 'studios/a.png')
  assert.equal(replacedLogoFile('studios/a.png', null), 'studios/a.png')
  assert.equal(replacedLogoFile('studios/a.png', 'studios/a.png'), null)
  assert.equal(replacedLogoFile(null, 'studios/a.png'), null)
})

test('never-checked rows are due whatever they hold; checked rows only without a logo', () => {
  assert.match(LOGO_CHECK_DUE_SQL, /logo_checked_at IS NULL OR/)
  assert.match(LOGO_CHECK_DUE_SQL, /logo_path IS NULL AND logo_checked_at < NOW\(\)/)
  assert.ok(LOGO_CHECK_DUE_SQL.includes(`'${LOGO_RECHECK_DAYS} days'`))
})
