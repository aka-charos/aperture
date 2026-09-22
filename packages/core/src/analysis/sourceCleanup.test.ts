/**
 * The cleaner, pinned against the page shapes it was written for.
 *
 * Every fixture here is a shape read off the second Requiem for a Dream bench:
 * IMDb's navigation menu, rogerebert.com's card wall, Wikipedia's Plot section.
 * The negative cases carry the weight, because this module edits documents that
 * are being KEPT - removing a paragraph of an article is a loss nothing
 * downstream can report.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NAVIGATION_RUN_LINES,
  cleanSourceText,
  cleanSources,
  isWidgetLine,
  stripFurnitureSections,
  stripNavigationRuns,
  stripPlotSections,
  stripWidgetLines,
} from './sourceCleanup.js'

const menu = (count: number) =>
  Array.from({ length: count }, (_, i) => `[Section ${i}](https://www.imdb.com/section/${i}/)`)

const paragraph =
  'Aronofsky uses extreme closeups to show the drugs acting on his characters, and the sequences run in fast motion.'

test('a run of link-only lines is a menu and goes', () => {
  const page = [...menu(12), '', paragraph, '', ...menu(9)].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('imdb.com/section'), false)
  assert.ok(cleaned.includes(paragraph))
})

test('blank lines inside a menu do not break the run', () => {
  const spaced = menu(8).flatMap((line) => [line, ''])
  const page = [paragraph, '', ...spaced, paragraph].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('imdb.com/section'), false)
  assert.equal(cleaned.split(paragraph).length - 1, 2, 'both paragraphs survive')
})

/**
 * ONE link line is a caption or a "read more", and a short list of related
 * links inside an article is not a menu. Removing those would take content out
 * of a page this module was told to keep.
 */
test('a short run of links is left alone', () => {
  const page = [paragraph, ...menu(NAVIGATION_RUN_LINES - 1), paragraph].join('\n')
  assert.equal(stripNavigationRuns(page), page)
})

test("an article's inline links are not lines and are never touched", () => {
  const wikipedia = [
    '***Requiem for a Dream*** is a 2000 American [psychological drama](https://en.wikipedia.org/wiki/Psychological_drama "Psychological drama") film directed by [Darren Aronofsky](https://en.wikipedia.org/wiki/Darren_Aronofsky "Darren Aronofsky").',
    '',
    'It stars [Ellen Burstyn](https://en.wikipedia.org/wiki/Ellen_Burstyn), [Jared Leto](https://en.wikipedia.org/wiki/Jared_Leto) and [Jennifer Connelly](https://en.wikipedia.org/wiki/Jennifer_Connelly).',
  ].join('\n')
  assert.equal(stripNavigationRuns(wikipedia), wikipedia)
})

/**
 * Wikipedia's article runs lead, Plot, Cast, Production, Release, Reception.
 * Both truncations above this are head-first, so on the bench the slice was
 * spent on the lead and the Plot and was cut off before Production - the one
 * document carrying the making and reception facts delivered neither.
 */
test('a plot section goes, and the section after it stays', () => {
  const page = [
    '***Requiem for a Dream*** is a 2000 American psychological drama film.',
    '',
    '## Plot',
    '',
    'Sara Goldfarb, a widow, watches television. Her son Harry and his friend Tyrone are heroin addicts.',
    '',
    '## Production',
    '',
    'Principal photography took place in Brooklyn from April to June 1999.',
  ].join('\n')
  const cleaned = stripPlotSections(page)
  assert.equal(cleaned.includes('Sara Goldfarb'), false)
  assert.equal(cleaned.includes('## Plot'), false)
  assert.ok(cleaned.includes('Principal photography'))
  assert.ok(cleaned.includes('psychological drama film'))
})

/**
 * The level comparison is what keeps a deeper heading from ending the removal
 * early, and a shallower one from being swallowed by it.
 */
test('a nested heading continues the plot section, an equal one ends it', () => {
  const page = [
    '## Synopsis',
    'Four people chase a dream.',
    '### Act one',
    'More of the same.',
    '## Reception',
    'Critics praised the performances.',
  ].join('\n')
  const cleaned = stripPlotSections(page)
  assert.equal(cleaned.includes('Act one'), false)
  assert.equal(cleaned.includes('Four people chase'), false)
  assert.ok(cleaned.includes('Critics praised the performances.'))
})

/**
 * Only unambiguous headings match. "Story" and "Summary" are words an essay
 * uses about its own argument, and missing a section costs a share of the
 * budget while removing the wrong one costs the analysis.
 */
test('an ambiguous heading is not a plot section', () => {
  for (const heading of ['## Summary', '## The story behind the film', '## Plot and structure']) {
    const page = [heading, 'Text that must survive.'].join('\n')
    assert.ok(stripPlotSections(page).includes('Text that must survive.'), heading)
  }
})

/**
 * Removing parts is this module's job; deciding a whole page is worthless is
 * sourceQuality's, with evidence behind it. So a strip that would leave nothing
 * leaves the page exactly as it was, and reports nothing removed.
 */
test('a page that is nothing but a menu is returned untouched', () => {
  const page = menu(30).join('\n')
  const result = cleanSourceText(page)
  assert.equal(result.text, page)
  assert.equal(result.stripped, 0)
})

test('cleaning reports what each page lost, in the original order', () => {
  const sources = [
    { domain: 'en.wikipedia.org', text: [paragraph, '', '## Plot', '', 'He does a thing.'].join('\n') },
    { domain: 'horrornews.net', text: paragraph },
    { domain: 'imdb.com', text: [...menu(12), '', paragraph].join('\n') },
  ]
  const { kept, cleaned } = cleanSources(sources)
  assert.deepEqual(
    kept.map((k) => k.domain),
    ['en.wikipedia.org', 'horrornews.net', 'imdb.com']
  )
  assert.deepEqual(
    cleaned.map((c) => c.domain),
    ['en.wikipedia.org', 'imdb.com']
  )
  assert.ok(cleaned.every((c) => c.stripped > 0))
  // The page with nothing to lose is the same object, not a copy.
  assert.equal(kept[1], sources[1])
  assert.equal(kept[0].text.includes('He does a thing'), false)
  assert.ok(kept[2].text.includes(paragraph))
})

/**
 * IMDb's navigation bar is ONE line carrying a dozen links, which is why the
 * run is measured in links: a line count sees it as a run of one and leaves the
 * largest single waste in the retrieval untouched. Shape copied off the second
 * Requiem bench, where imdb.com's title page spent its whole slice on two of
 * these and delivered a genre tag list.
 */
test('one line carrying a whole navigation bar is a menu by itself', () => {
  const bar = menu(12).join('')
  const page = [paragraph, '', bar, '', paragraph].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('imdb.com/section'), false)
  assert.equal(cleaned.split(paragraph).length - 1, 2)
})

/**
 * A menu is link bars separated by their own category labels, and treating
 * those as the end of a run cuts every real menu into pieces below the
 * threshold. What must NOT be bridged is a sentence.
 */
test("a menu's own category labels hold its run together", () => {
  const page = [
    paragraph,
    '',
    'Movies',
    menu(3).join(''),
    'TV shows',
    menu(3).join(''),
    'Watch',
    menu(3).join(''),
    '',
    '## The review',
    '',
    paragraph,
  ].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('imdb.com/section'), false)
  assert.equal(cleaned.includes('TV shows'), false, 'a label inside the run goes with it')
  // Filler OUTSIDE the run is left: the label before the first link could as
  // easily be the article's own heading, and so could the one after the last.
  // A stray word costs nothing; a lost heading costs the reader the section.
  assert.ok(cleaned.includes('Movies'))
  assert.ok(cleaned.includes('## The review'))
  assert.equal(cleaned.split(paragraph).length - 1, 2)
})

test('a short sentence is never read as filler', () => {
  const page = [menu(3).join(''), 'It opens on a television.', menu(3).join('')].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.ok(cleaned.includes('It opens on a television.'))
  assert.ok(cleaned.includes('imdb.com/section'), 'neither run reaches the threshold alone')
})

test('a single link between paragraphs is a caption, not a menu', () => {
  const page = [paragraph, '[Read the full review](https://www.example.com/x)', paragraph].join('\n')
  assert.equal(stripNavigationRuns(page), page)
})

/**
 * Rotten Tomatoes lost SIX characters to the link-run strip on the version-16
 * bench and still carried Where to Watch, Movie Clips, More Like This, Related
 * Movie News, Videos and Photos. Its furniture is prose-shaped text under
 * headings, which nothing counting links can see.
 */
test('a section the site writes about itself goes, and the criticism stays', () => {
  const page = [
    '## What to Know',
    '',
    'Though the movie may be too intense for some to stomach, the performances are hard to forget.',
    '',
    '## Where to Watch',
    '',
    'Watch it with a subscription on Peacock, rent on Fandango, or buy on Fandango.',
    '',
    '## Critics Reviews',
    '',
    'Clearly influenced by the cut-and-paste of hip-hop, it builds its tragic momentum.',
    '',
    '## More Like This',
    '',
    'Dancer in the Dark 69% 91% Watchlist The Virgin Suicides 80% 81% Watchlist',
  ].join('\n')
  const cleaned = stripFurnitureSections(page)
  assert.equal(cleaned.includes('Peacock'), false)
  assert.equal(cleaned.includes('Virgin Suicides'), false)
  assert.ok(cleaned.includes('hard to forget'))
  assert.ok(cleaned.includes('cut-and-paste of hip-hop'))
})

/**
 * Audience reviews are thin material, never furniture: every prompt version
 * allows one sentence on how ordinary viewers responded.
 */
test('audience and user reviews are kept', () => {
  for (const heading of ['## Audience Reviews', '## User Reviews']) {
    const page = [heading, 'It is one of the best films ever created. Will never watch again.'].join('\n')
    assert.ok(stripFurnitureSections(page).includes('never watch again'), heading)
  }
})

/**
 * The Ebert review lost nothing to either section strip and carried an embedded
 * video player's settings panel through the middle of it, with no links in any
 * of it. Lines taken verbatim off that bench.
 */
test('an interface widget flattened into markdown is not text', () => {
  for (const widget of [
    'SettingsOffArabicChineseEnglishFrenchGermanHindiPortugueseSpanish',
    'Font ColorwhiteFont Opacity100%Font Size100%Font FamilyArialText Shadownone',
    'WhiteBlackRedGreenBlueYellowMagentaCyan',
    '100%75%50%25%',
    '200%175%150%125%100%75%50%',
    'NoneRaisedDepressedUniformDrop Shadow',
  ]) {
    assert.equal(isWidgetLine(widget), true, widget)
  }
})

/**
 * A sentence naming a person whose name runs two capitals together is prose.
 * Three joins are required for exactly this reason.
 */
test('ordinary prose with a capital inside a word is never a widget', () => {
  for (const line of [
    'She is addicted to a game show whose host, Christopher McDonald, leads the audience.',
    'Aronofsky brings a new urgency to the drug movie through his subjective camera',
    'The iPhone footage was shot by DeMarco in New York',
    'Video Muted',
  ]) {
    assert.equal(isWidgetLine(line), false, line)
  }
})

test('widget lines go, and the paragraphs around them stay', () => {
  const page = [
    paragraph,
    '',
    'SettingsOffArabicChineseEnglishFrenchGermanHindiPortugueseSpanish',
    '',
    '100%75%50%25%',
    '',
    paragraph,
  ].join('\n')
  const cleaned = stripWidgetLines(page)
  assert.equal(cleaned.includes('Arabic'), false)
  assert.equal(cleaned.includes('100%75%'), false)
  assert.equal(cleaned.split(paragraph).length - 1, 2)
})

/**
 * Metacritic writes each of its eighteen cast entries as one link over three
 * lines - photograph, blank, then "Ellen BurstynSara Goldfarb](/person/…)" - so
 * the photograph scores one link, the closing line reads as content, and every
 * entry breaks the run at a weight of one. Shape taken off the version-16
 * bench, where the list survived both strips and 40% of that page was credits.
 */
test('a cast list written as multi-line links is a run', () => {
  const entry = (name: string, role: string, slug: string) =>
    [
      `[![${name}](https://www.metacritic.com/a/img/resize/${slug}.jpg)`,
      '',
      `${name}${role}](/person/${slug}/)`,
    ].join('\n')
  const page = [
    paragraph,
    '',
    entry('Ellen Burstyn', 'Sara Goldfarb', 'ellen-burstyn'),
    entry('Jared Leto', 'Harry Goldfarb', 'jared-leto'),
    entry('Jennifer Connelly', 'Marion Silver', 'jennifer-connelly'),
    entry('Marlon Wayans', 'Tyrone C. Love', 'marlon-wayans'),
    entry('Louise Lasser', 'Ada', 'louise-lasser'),
    '',
    paragraph,
  ].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('Sara Goldfarb'), false)
  assert.equal(cleaned.includes('metacritic.com/a/img'), false)
  assert.equal(cleaned.split(paragraph).length - 1, 2)
})

test('a sentence that happens to end in a link is not a link tail', () => {
  const page = [
    'Aronofsky uses extreme closeups to show the drugs acting on his characters, as set out in [the full review](https://example.com/x)',
    'It opens on a television chained to a radiator, and the son wheels it to a pawn shop.',
  ].join('\n')
  assert.equal(stripNavigationRuns(page), page)
})

/**
 * A menu whose every entry is links PLUS a caption, which is bfi.org.uk's.
 *
 * The shipped strip removed 0% of this page, because a line that is neither
 * link-only nor filler broke the run at every item and the counter reached four
 * where it needed five. It is the shape that lets a page consisting entirely of
 * menu lose nothing at all.
 */
test('links plus a short caption are a menu entry, not a break in the run', () => {
  const page = [
    '[Skip to content](#content-start)',
    '[![BFI home](/dist/client/e51.svg)](/)[![BFI home](/dist/client/e51.svg)](/)Menu',
    '',
    '*   [![BFI home](/dist/client/e51.svg)](/)',
    '*   [Watch and discover](/)Open submenu',
    '*   [Learning and training](/learning-training)Open submenu',
    '*   [Funding and industry](/funding-industry)Open submenu',
    '',
    '[Become a Member](/become-a-bfi-member)[Shop](https://shop.bfi.org.uk/)',
    '',
    'The master of giallo looks back on his horror masterpiece at 40 in this celebratory video interview.',
  ].join('\n')
  const cleaned = stripNavigationRuns(page)
  assert.equal(cleaned.includes('Open submenu'), false)
  assert.equal(cleaned.includes('Skip to content'), false)
  assert.equal(cleaned.includes('Become a Member'), false)
  assert.ok(cleaned.includes('The master of giallo'))
})

/** A caption is a caption because it carries no sentence, however short it is. */
test('a link with a sentence beside it is never a menu entry', () => {
  const page = [
    '[Read more](/x)',
    '[Read more](/y)',
    '[Read more](/z)',
    '[Read more](/a)',
    'Argento saturates the film in solid primary colours, as [one review](/b) sets out.',
    'The camera hovers and glides through the rooms without taking anyone as its subject.',
  ].join('\n')
  assert.ok(stripNavigationRuns(page).includes('Argento saturates'))
})
