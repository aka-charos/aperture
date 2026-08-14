/**
 * Title normalization — the pure half of foreign-title matching.
 *
 * The SQL half (unaccent over title/original_title/sort_title) can only be
 * checked against a live database; this pins the part that decides whether a
 * row, once fetched, is accepted as the film the candidate named.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTitle,
  titlesOverlap,
  anyTitleMatchesSql,
  titleMatchRankSql,
} from './titleMatch.js'

describe('normalizeTitle', () => {
  test('folds accents instead of deleting them', () => {
    // The original bug: stripping [^a-z0-9] turned "é" into nothing, so the two
    // spellings of one film normalized to "l chafaud" and "l echafaud".
    assert.equal(normalizeTitle("Ascenseur Pour L'échafaud"), 'ascenseur pour l echafaud')
    assert.equal(
      normalizeTitle("Ascenseur pour l'echafaud"),
      normalizeTitle("Ascenseur Pour L'échafaud")
    )
  })

  test('accent folding covers the common European marks', () => {
    assert.equal(normalizeTitle('Le Samouraï'), 'le samourai')
    assert.equal(normalizeTitle('Amélie'), 'amelie')
    assert.equal(normalizeTitle('El Laberinto del Fauno'), 'el laberinto del fauno')
    assert.equal(normalizeTitle('Los Olvidados'), 'los olvidados')
    assert.equal(normalizeTitle('Persepolis'), 'persepolis')
  })

  test('expands ligatures NFD cannot reach', () => {
    // These have no combining-mark decomposition, so stripping marks is not
    // enough — without the map, Nordic and German titles stay unmatchable.
    assert.equal(normalizeTitle('Straße'), 'strasse')
    assert.equal(normalizeTitle('Rødt'), 'rodt')
    assert.equal(normalizeTitle('Æon Flux'), 'aeon flux')
    assert.equal(normalizeTitle('Łódź'), 'lodz')
  })

  test('collapses punctuation and case the way it always did', () => {
    assert.equal(normalizeTitle('  The   Godfather: Part II  '), 'the godfather part ii')
    assert.equal(normalizeTitle('WALL·E'), 'wall e')
  })

  test('a title of pure punctuation normalizes to empty, not to a space', () => {
    assert.equal(normalizeTitle('!!!'), '')
    assert.equal(normalizeTitle('   '), '')
  })

  test('non-Latin scripts survive as empty rather than throwing', () => {
    // Nothing in [a-z0-9] remains, so these can never match by title text and
    // must fall through to the id tiers. The contract is "empty", not a crash.
    assert.equal(normalizeTitle('七人の侍'), '')
    assert.equal(normalizeTitle('Ran 乱'), 'ran')
  })
})

describe('titlesOverlap', () => {
  test('matches across accent spellings', () => {
    assert.equal(titlesOverlap("Ascenseur pour l'echafaud", "Ascenseur Pour L'échafaud"), true)
  })

  test('matches when one side carries a subtitle', () => {
    assert.equal(titlesOverlap('Le Samouraï', 'Le Samourai: The Godson'), true)
  })

  test('does not match unrelated titles', () => {
    assert.equal(titlesOverlap('Le Samouraï', 'Le Cercle Rouge'), false)
  })

  test('an empty side is not a match', () => {
    // Deliberate: resolveCandidates treats "nothing to compare" as trusting an
    // exact ID hit, which is a decision for the caller, not for this helper.
    assert.equal(titlesOverlap('七人の侍', 'Seven Samurai'), false)
    assert.equal(titlesOverlap('', 'Rififi'), false)
  })
})

describe('SQL fragment builders', () => {
  test('search all three name columns', () => {
    const sql = anyTitleMatchesSql('$1')
    for (const col of ['title', 'original_title', 'sort_title']) {
      assert.ok(sql.includes(col), `missing ${col}`)
    }
    assert.ok(sql.includes('unaccent'), 'must be accent-insensitive')
  })

  test('qualify with an alias when given one, and not when not', () => {
    assert.ok(anyTitleMatchesSql('$1', 'm').includes('m.original_title'))
    assert.ok(!anyTitleMatchesSql('$1').includes('.original_title'))
  })

  test('rank prefers the localized title over the original', () => {
    const sql = titleMatchRankSql('$2')
    // The name on the poster must win; a row matching only in another language
    // should never outrank an exact hit on what the user sees.
    assert.ok(sql.indexOf('LOWER(title)') < sql.indexOf('original_title'))
  })

  test('interpolate only the placeholder they are given', () => {
    // These builders concatenate into SQL, so the guard is that nothing but a
    // caller-authored $n placeholder ever reaches the string.
    assert.ok(!anyTitleMatchesSql('$1').includes("'%"))
    assert.equal((titleMatchRankSql('$2').match(/\$2/g) ?? []).length, 3)
  })
})
