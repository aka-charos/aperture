import test from 'node:test'
import assert from 'node:assert/strict'
import {
  interestAffinityFromEvidence,
  interestTerms,
  matchInterestEvidence,
  readInterestEvidence,
} from './interestEvidence.js'

test('a keyword saying the whole interest is phrase evidence', () => {
  // The Drama (2026), the live "dark comedy" pick: TMDb tags it so.
  const evidence = matchInterestEvidence('dark comedy', {
    genres: ['Romance', 'Comedy', 'Drama'],
    keywords: ['infidelity', 'dark comedy', 'romcom'],
  })
  assert.deepEqual(evidence, { strength: 'phrase', matched: ['dark comedy'] })
})

test('the words of a phrase are not the phrase', () => {
  // The titles nearest "dark comedy" in the embedding: Dark Horse (2011) is a
  // drama and The King of Comedy carries no dark-comedy tag. Neither may fill
  // a "dark comedy" slot on the strength of its words.
  assert.equal(
    matchInterestEvidence('dark comedy', { genres: ['Drama'], keywords: ['dark horse'] }),
    null
  )
  assert.equal(
    matchInterestEvidence('dark comedy', { genres: ['Comedy', 'Crime', 'Drama'], keywords: ['stand-up comedy'] }),
    null
  )
})

test('an interest assembled from whole facts is parts evidence', () => {
  // Children of Men for "dystopian sci-fi": keyword dystopia + the genre.
  const evidence = matchInterestEvidence('dystopian sci-fi', {
    genres: ['Drama', 'Science Fiction', 'Thriller'],
    keywords: ['future', 'police state', 'dystopia'],
  })
  assert.deepEqual(evidence, { strength: 'parts', matched: ['dystopia', 'Science Fiction'] })
})

test('every word must be covered for parts evidence', () => {
  assert.equal(
    matchInterestEvidence('dystopian sci-fi', { genres: ['Science Fiction'], keywords: ['space'] }),
    null
  )
})

test('plurals, filler words and accents fold', () => {
  assert.deepEqual(interestTerms('Dark comedies'), ['dark', 'comedy'])
  assert.deepEqual(interestTerms('Time travel stories'), ['time', 'travel'])
  assert.deepEqual(interestTerms('I love underdog sports dramas'), ['underdog', 'sport', 'drama'])
  assert.deepEqual(
    matchInterestEvidence('Time travel stories', { keywords: ['time travel'] }),
    { strength: 'phrase', matched: ['time travel'] }
  )
  assert.deepEqual(
    matchInterestEvidence('film noir', { keywords: ['Film Noir'] }),
    { strength: 'phrase', matched: ['Film Noir'] }
  )
})

test('containment counts only for interests of two words or more', () => {
  assert.deepEqual(
    matchInterestEvidence('time travel', { keywords: ['time travel paradox'] }),
    { strength: 'phrase', matched: ['time travel paradox'] }
  )
  // One word inside a longer keyword is how "war" would match "star wars".
  assert.equal(matchInterestEvidence('war', { keywords: ['star wars'] }), null)
  assert.deepEqual(matchInterestEvidence('war', { genres: ['War'] }), { strength: 'phrase', matched: ['War'] })
})

test('nothing to match on is no evidence', () => {
  assert.equal(matchInterestEvidence('', { keywords: ['dark comedy'] }), null)
  assert.equal(matchInterestEvidence('movies about stories', { keywords: ['story'] }), null)
  assert.equal(matchInterestEvidence('dark comedy', {}), null)
  assert.equal(matchInterestEvidence('dark comedy', { genres: null, keywords: [' '] }), null)
})

test('affinity tiers follow the evidence and the weight scales toward neutral', () => {
  assert.equal(interestAffinityFromEvidence(null), 0.5)
  assert.equal(interestAffinityFromEvidence({ strength: 'phrase', matched: ['x'] }), 1.0)
  assert.equal(interestAffinityFromEvidence({ strength: 'parts', matched: ['x', 'y'] }), 0.8)
  // NUMERIC arrives as a string.
  assert.equal(interestAffinityFromEvidence({ strength: 'phrase', matched: ['x'] }, '0.5'), 0.75)
  assert.equal(interestAffinityFromEvidence({ strength: 'phrase', matched: ['x'] }, 0), 0.5)
  assert.equal(interestAffinityFromEvidence({ strength: 'phrase', matched: ['x'] }, 'junk'), 1.0)
})

test('stored evidence is read back only when well formed', () => {
  assert.deepEqual(readInterestEvidence({ strength: 'phrase', matched: ['dark comedy'] }), {
    strength: 'phrase',
    matched: ['dark comedy'],
  })
  for (const value of [null, {}, { strength: 'close', matched: ['x'] }, { strength: 'phrase', matched: [] }, { strength: 'parts', matched: 'x' }]) {
    assert.equal(readInterestEvidence(value), null, JSON.stringify(value))
  }
})
