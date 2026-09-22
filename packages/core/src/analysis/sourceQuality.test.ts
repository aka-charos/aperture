import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CHARS_PER_TITLE_MENTION,
  dropLowValueSources,
  hasNoProse,
  isNavigationPage,
  isOffTopic,
} from './sourceQuality.js'

const prose = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) =>
      `The film's ${i} choice is described at length here, and the paragraph runs on for a while.`
  ).join('\n\n')

const source = (domain: string, text = prose(6)) => ({ domain, text })

test('a listed domain is dropped, with its subdomains and none of its lookalikes', () => {
  const { kept, dropped } = dropLowValueSources([
    source('arcplot.com'),
    source('www.shapes.inc'),
    source('en.wikipedia.org'),
    source('notarcplot.com'),
    source('sensesofcinema.com'),
  ])
  assert.deepEqual(
    kept.map((s) => s.domain),
    ['en.wikipedia.org', 'notarcplot.com', 'sensesofcinema.com']
  )
  assert.deepEqual(dropped, [
    { domain: 'arcplot.com', reason: 'listed-domain' },
    { domain: 'www.shapes.inc', reason: 'listed-domain' },
  ])
})

/**
 * The measured page: 8,607 characters of site navigation - Singapore
 * influencer marketing, FRM course fees - and not one sentence about the film,
 * which is 13% of the retrieval budget spent on a menu.
 */
test('a page that is mostly stand-alone links is a menu', () => {
  const menu = Array.from(
    { length: 30 },
    (_, i) => `[![](https://example.com/thumb-${i}.png)](https://example.com/post-${i} "Post ${i}")`
  ).join('\n')
  assert.equal(isNavigationPage(menu), true)
  assert.equal(isNavigationPage(`${menu}\n\n${prose(2)}`), true, 'a little prose does not rescue it')
})

/**
 * THE TRAP THIS IS SHAPED AROUND. Wikipedia's markdown is more than half link
 * CHARACTERS - every proper noun in every sentence is one - so a link-density
 * measure drops the best document in the set. What separates a menu is that its
 * links stand alone on their own lines.
 */
test('a prose page dense with inline links is not a menu', () => {
  const encyclopedia = Array.from(
    { length: 12 },
    () =>
      'It was directed by [Darren Aronofsky](https://en.wikipedia.org/wiki/Darren_Aronofsky "Darren Aronofsky") and written with [Hubert Selby Jr.](https://en.wikipedia.org/wiki/Hubert_Selby_Jr. "Hubert Selby Jr."), based on his [1978 novel](https://en.wikipedia.org/wiki/Requiem "novel").'
  ).join('\n\n')
  assert.equal(isNavigationPage(encyclopedia), false)
  // A short list of links is not enough on its own, for blockedPage's reason:
  // losing a real article to a heuristic costs more than keeping a menu.
  assert.equal(isNavigationPage('[one](https://a.example)\n[two](https://b.example)'), false)
})

test('nothing is dropped when dropping would leave nothing', () => {
  const only = [source('arcplot.com'), source('shapes.inc')]
  const { kept, dropped } = dropLowValueSources(only)
  assert.equal(kept.length, 2, 'a thin retrieval is the floor’s decision, not this module’s')
  assert.deepEqual(dropped, [])
})

test('an empty retrieval is left alone rather than reported as dropped', () => {
  assert.deepEqual(dropLowValueSources([]), { kept: [], dropped: [] })
})

/**
 * The page that motivated the second shape test: rogerebert.com's director
 * index, which took one of the two curated criticism slots on the Requiem for a
 * Dream bench. Each review is a markdown link spread over five lines - poster,
 * heading, byline, star images, then the "](url)" that closes it - so the
 * line-share test sees ordinary-looking lines and the page survives.
 */
const reviewCard = (film: string, critic: string) =>
  [
    '[![' + film + '](https://www.rogerebert.com/uploads/' + film + '.jpg) ',
    '### ' + film,
    critic + ' ',
    '![star rating](https://www.rogerebert.com/stars-fill.svg) ![star rating](https://www.rogerebert.com/stars.svg) ',
    'Director](https://www.rogerebert.com/reviews/' + film + ')',
  ].join('\n')

const directorIndex = Array.from({ length: 12 }, (_, i) =>
  reviewCard('Film' + i, ['Nell Minow', 'Christy Lemire', 'Brian Tallerico'][i % 3])
).join('\n\n')

test('a wall of review cards has no sentence in it, and the line share cannot see it', () => {
  // The share lands near 0.4 against a 0.6 threshold, which is the gap.
  assert.equal(isNavigationPage(directorIndex), false)
  assert.equal(hasNoProse(directorIndex), true)
  const { kept, dropped } = dropLowValueSources([
    source('en.wikipedia.org'),
    { domain: 'www.rogerebert.com', text: directorIndex },
  ])
  assert.deepEqual(kept.map((k) => k.domain), ['en.wikipedia.org'])
  assert.deepEqual(dropped, [{ domain: 'www.rogerebert.com', reason: 'no-prose' }])
})

/**
 * An unpaired bracket is punctuation. "[" and "]" were missing from the final
 * strip, so the line that OPENS a link closing further down the page left a
 * lone "[" behind and read as content. Verified against the fix by counting a
 * page made only of those lines: without it the share is 0.
 */
test('a line opening a link that closes further down is still a link line', () => {
  const posters = Array.from(
    { length: 24 },
    (_, i) => '[![Film' + i + '](https://www.rogerebert.com/uploads/' + i + '.jpg) '
  ).join('\n')
  assert.equal(isNavigationPage(posters), true)
})

/**
 * One sentence is enough to keep a page, and a scraper that emits a whole
 * article as a single long line still trips it once. Losing an article costs
 * the analysis; keeping a menu costs a share of the budget.
 */
test('a single sentence keeps a page, however it is laid out', () => {
  const oneLine =
    'Aronofsky uses extreme closeups to show the drugs acting on his characters, and the sequences run in fast motion so the highs arrive and fade.'
  assert.equal(hasNoProse(oneLine), false)
  assert.equal(hasNoProse(directorIndex + '\n' + oneLine), true, 'one caption does not save a menu')
  assert.equal(hasNoProse(prose(1)), false)
})

/**
 * A failed scrape gets its own reason, because "the fetch came back empty" is a
 * fault in RETRIEVAL and "this page has no prose in it" is a fact about the
 * page. Measured on a New York Times review that arrived as 11 characters - its
 * own domain - and reached the prompt as a numbered document.
 */
test('a fetch that came back empty is named as empty, not as a bad page', () => {
  const { kept, dropped } = dropLowValueSources([
    source('en.wikipedia.org'),
    { domain: 'nytimes.com', text: 'nytimes.com' },
  ])
  assert.deepEqual(kept.map((k) => k.domain), ['en.wikipedia.org'])
  assert.deepEqual(dropped, [{ domain: 'nytimes.com', reason: 'empty' }])
})

test('an empty fetch is still kept when it is all there is', () => {
  const only = [{ domain: 'nytimes.com', text: 'nytimes.com' }]
  assert.deepEqual(dropLowValueSources(only), { kept: only, dropped: [] })
})

/**
 * The version-16 bench spent 7,833 characters - twelve per cent of the prompt -
 * on a Sight and Sound poll of the best films of 2006, retrieved by the curated
 * criticism search and marked as criticism in the report. Real prose, real
 * publication, real films, and not about this one. Nothing else here can see it.
 */
test('a page that never names the film is off-topic, however good it is', () => {
  // Both are comfortably above the size floor, or every document would be
  // dropped and the fail-open would hand the whole set back untouched.
  const poll = [
    'The best films of 2006. Hidden by Michael Haneke took the top place in the poll this year.',
    'Volver came second, and The Departed, The Queen and Red Road shared the third position.',
    'A half-hour digital essay on cinema, death, fiction, war, home and memory, made quickly.',
  ]
    .join('\n\n')
    .repeat(3)
  const review = [
    'Requiem for a Dream opens with a housewife chaining her television to the radiator.',
    'Aronofsky uses extreme closeups to show the drugs acting on his characters in this film.',
  ]
    .join('\n\n')
    .repeat(3)

  const { kept, dropped } = dropLowValueSources(
    [
      { domain: 'rogerebert.com', text: review },
      { domain: 'bfi.org.uk', text: poll },
    ],
    ['Requiem for a Dream']
  )
  assert.deepEqual(kept.map((k) => k.domain), ['rogerebert.com'])
  assert.deepEqual(dropped, [{ domain: 'bfi.org.uk', reason: 'off-topic' }])

  // Without the names the test does not run at all, which is what every caller
  // that does not know the title should get.
  assert.equal(dropLowValueSources([{ domain: 'bfi.org.uk', text: poll }]).dropped.length, 0)
})

/**
 * Mentions per character, not a bare mention: the page a film is merely LISTED
 * on names it once. Loose enough that anything discussing the film clears it.
 */
test('one passing mention does not make a long page about the film', () => {
  const filler = 'The poll gathered ballots from critics and programmers across the year. '
  const listing = filler.repeat(600) + 'Requiem for a Dream also received a vote. ' + filler.repeat(600)
  assert.ok(listing.length > CHARS_PER_TITLE_MENTION * 2)
  assert.equal(isOffTopic(listing, ['Requiem for a Dream']), true)
  // The same page, naming it as often as a review would.
  const about = listing.split('. ').join('. Requiem for a Dream. ')
  assert.equal(isOffTopic(about, ['Requiem for a Dream']), false)
})

test('the original title counts, and a short title is never tested', () => {
  const french = 'Un film de Gaspar Noe. Seul contre tous est un film francais de 1998.'
  assert.equal(isOffTopic(french, ['I Stand Alone', 'Seul contre tous']), false)
  // "Up" would match inside every document ever written, so it is skipped.
  assert.equal(isOffTopic('A page about nothing in particular at all.', ['Up']), false)
})

/**
 * reddit.com's related-discussions page, which is 9,836 characters of OTHER
 * threads' titles and their vote counts with no comment body anywhere on it.
 *
 * A thread title IS a sentence, so a wall of them scored three prose lines,
 * cleared MIN_PROSE_LINES by exactly one, and passed every test in this file -
 * while the cleaner, over the same text, stripped nothing.
 */
test('a page whose every sentence is somebody else’s headline has no prose', () => {
  const thread = (title: string, id: string) =>
    [
      '*   [' + title + '](https://www.reddit.com/r/horror/comments/' + id + '/)',
      '',
      '[![](https://styles.redditmedia.com/t5_2qh9x/styles/icon.png?width=48&s=555d)',
      '',
      'r/horror](https://www.reddit.com/r/horror/)',
      '',
      ' • 9mo ago',
      '',
      '[### ' + title + '](/r/horror/comments/' + id + '/)',
      '',
      '119 upvotes · 45 comments',
      '',
      '* * *',
    ].join('\n')
  const page = [
    '# Suspiria (1977) is the best Horror movie of all time : r/horror - Reddit',
    '',
    thread(
      'Finally watched Suspiria for the first time and completely blind. Another classic to mark off my list.',
      '1plo1iw'
    ),
    thread(
      'I rewatched The Exorcist. I take back everything I said about it previously. This movie is genuinely horrifying.',
      'ulb938'
    ),
  ].join('\n')
  assert.equal(hasNoProse(page), true)
})

/** The control: the review in the same retrieval, which must survive. */
test('an article with headings above its paragraphs is still prose', () => {
  const page = [
    '# Suspiria',
    '',
    '#### By Brian Eggert | October 28, 2018',
    '',
    'A phantasmagoria of unnatural colours and only slightly less unnatural situations, this remains the Italian director’s finest achievement.',
    '',
    '## Style',
    '',
    'His aesthetic approach triumphs over the necessity for dramatic context, creating an experience that proves haunting throughout.',
  ].join('\n')
  assert.equal(hasNoProse(page), false)
})
