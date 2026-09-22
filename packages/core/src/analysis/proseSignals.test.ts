/**
 * The habit counts, pinned against the phrasings they were written for.
 *
 * Each positive case is a sentence shape taken from a version-8 analysis. The
 * negative cases matter as much: a count that fires on attributed prose would
 * report the fix as the fault.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { measureProse, namesFromDocuments, writerNamesFromSources } from './proseSignals.js'

test('an empty or missing analysis measures as zero everywhere', () => {
  for (const text of [null, undefined, '', '   ']) {
    const s = measureProse(text)
    const { repeatedPhrases, namedWriterMatches, mapped, ...counts } = s
    // Every count, named rather than positional: a fixed-length array here has
    // to be edited for each new column, and editing it is when a genuine zero
    // gets written in beside the cosmetic one.
    assert.deepEqual(
      Object.entries(counts).filter(([, value]) => value !== 0),
      []
    )
    assert.ok(Object.keys(counts).length >= 15, 'the shape did not collapse')
    assert.deepEqual(repeatedPhrases, [])
    assert.deepEqual(namedWriterMatches, [])
    assert.equal(mapped, false)
  }
})

test('counts words, paragraphs and the longest paragraph in sentences', () => {
  const s = measureProse(
    ['One sentence here. Two sentences here.', 'Alone. Two. Three. Four. Five sentences.'].join('\n\n')
  )
  assert.equal(s.paragraphs, 2)
  assert.equal(s.longestParagraph, 5)
  assert.equal(s.words, 12)
})

// Withnail & I under version 13 read as a five-sentence paragraph because of
// "Richard E. Grant".
test('an initial is not a sentence end', () => {
  const s = measureProse(
    'Richard E. Grant plays Withnail with excess. Paul McGann plays against him. The pair carry it. Their bond is the core.'
  )
  assert.equal(s.longestParagraph, 4)
})

test('pointing at the retrieval, including the synonym version 8 missed', () => {
  assert.equal(measureProse('That line is the clearest statement of purpose the sources carry.').pointsAtSources, 1)
  assert.equal(measureProse('The source documents disagree.').pointsAtSources, 1)
  assert.equal(measureProse('Critics praised its sound design.').pointsAtSources, 0)
  // Withnail & I under version 13, and two innocent uses of the word.
  assert.equal(measureProse('One fan-adjacent source credits it with influence.').pointsAtSources, 1)
  assert.equal(measureProse('One source of tension is the flat.').pointsAtSources, 0)
  assert.equal(measureProse('Robinson drew on one source novel.').pointsAtSources, 0)
})

test('a view with no holder, and not a view with one', () => {
  assert.equal(
    measureProse(
      "Possession works as a psychological exorcism, according to one critical read. Adjani's performance is described as controlled hysteria. Its influence has been traced to David Lynch."
    ).unattributed,
    // "according to one" and "one critical read" are both in the first sentence.
    4
  )
  assert.equal(measureProse('Cath Clarke, writing in The Guardian, called it an easy pleasure.').unattributed, 0)
  // Terminator 2 under version 12.
  assert.equal(
    measureProse('Its technical achievements are said to have changed how blockbusters were made.').unattributed,
    1
  )
  // Withnail & I and The Wretches Are Still Singing under version 13.
  assert.equal(
    measureProse(
      'The film has been credited with influencing independent film-making. A philosophical reading takes it as a romance of self-destruction. One retrospective account holds that the score made it.'
    ).unattributed,
    3
  )
  assert.equal(measureProse('A scholar reads it as a parody of Hamlet.').unattributed, 0)
  // The Wretches Are Still Singing under version 14.
  assert.equal(
    measureProse(
      'The retrospective account is explicit that the sound was his. It was a reaction the retrospective press placed in a moral panic.'
    ).unattributed,
    2
  )
  assert.equal(measureProse('The press screening sold out.').unattributed, 0)
  // Requiem for a Dream: four misses on one shape, all of them a holder that
  // is not a person. "held" was named a bench earlier and was still missing.
  assert.equal(
    measureProse(
      'One account describes it as vertigo. One analysis traces the seasons. A recurring interpretive line held that it is about appetite.'
    ).unattributed,
    3
  )
  // Not a negative test for "the account was …": that shape is a holder with
  // no person in ordinary prose too, and this is an instrument, not a validator.
  assert.equal(measureProse('The press screening sold out again.').unattributed, 0)
})

/**
 * Version 13 keeps writers in reception. Kontroll under version 12 opened its
 * context with "Critics have placed it", and The Zero Years ran "one Italian
 * critic ... another viewer" through its form answer.
 */
test('a writer named outside the reception answer is counted, and only there', () => {
  const text = [
    'Critics have placed it in post-socialist cinema.',
    'One critic reads the colour as politics, and another viewer found it a panopticon.',
    'The red handrails flare against the dark and put the viewer on edge.',
    'Critics praised its look, and one scholar faulted its dialogue.',
    'A reviewer praised the ending.',
  ].join('\n\n')
  const s = measureProse(text, [['tradition'], ['work'], ['work'], ['reception'], []])
  // 1 + 2; "the viewer" is how an effect is described; reception and an
  // unlabelled paragraph do not count.
  assert.equal(s.spill, 3)
  assert.equal(measureProse(text).spill, 0, 'without a map there are no sections to spill into')
  assert.equal(measureProse(text, [['dispute'], ['dispute'], [], [], []]).spill, 0, 'version-8 dispute is reception')
})

// The prompt caps reception at the length of the work answer. Words are
// counted from the model's own labels, so an unlabelled paragraph counts for
// neither, and without a map nothing is measured.
test('reception and work words are counted from the labels, and semicolons always', () => {
  const text = ['One two three four.', 'Five six.', 'Seven eight nine; ten.', 'Eleven.'].join('\n\n')
  const s = measureProse(text, [['work'], ['work', 'reception'], ['reception'], []])
  assert.equal(s.workWords, 6)
  assert.equal(s.receptionWords, 6)
  assert.equal(s.semicolons, 1)
  assert.equal(s.mapped, true)
  assert.equal(measureProse(text, [['dispute'], [], [], []]).receptionWords, 4, 'version-8 dispute is reception')

  const unmapped = measureProse(text)
  assert.equal(unmapped.mapped, false)
  assert.equal(unmapped.workWords + unmapped.receptionWords, 0)
  assert.equal(unmapped.semicolons, 1)
  assert.equal(measureProse(text, [[], [], [], []]).mapped, false, 'a map with no labels is no map')
})

test('rather than, and instead of', () => {
  assert.equal(
    measureProse('It is inherited rather than borrowed, instead of punctuating it.').ratherThan,
    2
  )
})

test('announcing that a question stays open', () => {
  assert.equal(measureProse('These disagreements remain unresolved.').leftOpen, 1)
  assert.equal(measureProse('These readings do not cancel each other out.').leftOpen, 1)
  assert.equal(measureProse('Whether it is a defect is left open by the people reviewing it.').leftOpen, 1)
  assert.equal(measureProse('The door is left ajar.').leftOpen, 0)
})

// Withnail & I under version 13.
test('a paragraph opening on "the circumstances of production" restates its question', () => {
  assert.equal(measureProse('The circumstances of production left their mark too.').questionEchoes, 1)
})

// Only a paragraph's OPENING counts, because the same words mid-paragraph are
// ordinary prose rather than a restated question.
test('a paragraph opening by restating its question', () => {
  const s = measureProse(
    [
      'The film sits in psychological horror.',
      'Critics disagree about what genre the film belongs to.',
      "The film's governing formal idea is to put the audience inside a listener.",
      'Remarque’s novel had been filmed twice before. The film sits in that line.',
    ].join('\n\n')
  )
  assert.equal(s.questionEchoes, 3)
})

/**
 * Terminator 2 under version 9, cut to the paragraphs that matter: the early
 * screenplay's liquid-metal idea told under Context and again under Making.
 */
const T2 = [
  'Cameron drew on an early version of the original screenplay that contained a liquid-metal terminator, an idea he had scrapped.',
  'Brad Fiedel wrote a score of industrial percussion.',
  'Robert Patrick plays the pursuer with a fixed, gliding stillness.',
  'The liquid-metal idea came from an early version of the original screenplay and became possible after The Abyss.',
  'Brian Eggert praised the action and faulted the script.',
].join('\n\n')
const T2_SECTIONS = [['tradition'], ['work'], ['work'], ['circumstances'], ['reception']]

/**
 * Whether it is good belongs to the reception answer in every prompt version,
 * and the work answers on the Requiem bench carried four of these verbatim.
 * Scoped exactly as spill is, for the same reason.
 */
test('quality words are counted outside the reception answer only', () => {
  const text = [
    'Her emaciated face is the part that leaves the deepest mark.',
    'The quartet of performances gives the descent its soul-shattering weight.',
    'A critic called the technique remarkable and the performances extraordinary.',
  ].join('\n\n')
  const s = measureProse(text, [['work'], ['work'], ['reception']])
  assert.equal(s.praise, 2, 'the reception paragraph is where a verdict belongs')
  assert.equal(measureProse(text).praise, 0, 'without a map there are no sections to judge')
  // Description is not a verdict: these must not be counted.
  assert.equal(
    measureProse('The grim, hallucinatory images are relentless.', [['work']]).praise,
    0
  )
})

/**
 * "No scores, no list of awards" - and one answer named a Golden Globe and an
 * Oscar. Whole-answer rather than scoped, so it needs no map.
 */
test('named awards are counted wherever they appear', () => {
  assert.equal(
    measureProse('It was nominated for a Golden Globe and an Oscar for its lead.').awards,
    2
  )
  assert.equal(measureProse('It premiered at Cannes out of competition.').awards, 0)
})

test('a fact told under two questions is found and named', () => {
  const s = measureProse(T2, T2_SECTIONS)
  assert.ok(s.repeatedPhrases.includes('liquid metal'), s.repeatedPhrases.join(', '))
  assert.ok(s.repeatedPhrases.includes('original screenplay'), s.repeatedPhrases.join(', '))
  assert.equal(s.repeatedAcrossSections, s.repeatedPhrases.length)
})

// The version-11 bench printed "brian eggert", "james cameron" and "edward
// furlong" as facts told twice; a person doing two things is not a repeat.
test('names and the genre vocabulary are not counted as facts told twice', () => {
  const text = [
    'Brian Eggert traces the science fiction chases to James Cameron.',
    'Brian Eggert faults the science fiction script, and James Cameron agreed.',
  ].join('\n\n')
  assert.deepEqual(measureProse(text, [['tradition'], ['reception']]).repeatedPhrases, [])
})

// Two runs sharing a label are one question, however they are split.
test('a phrase repeated inside one question is not a repeat', () => {
  const text = ['The liquid-metal pursuer glides.', 'The liquid-metal pursuer never runs.'].join('\n\n')
  assert.deepEqual(measureProse(text, [['work'], ['work', 'tradition']]).repeatedPhrases, [])
})

test('without a paragraph map there are no questions to repeat across', () => {
  assert.equal(measureProse(T2).repeatedAcrossSections, 0)
  assert.equal(measureProse(T2, []).repeatedAcrossSections, 0)
})

/**
 * THE PROMPT'S OWN NOUN IS "DOCUMENTS" and this counted only "sources" for
 * three versions, so a model obeying the rule's letter scored clean. Measured
 * on the Requiem for a Dream bench.
 */
test('pointing at the documents counts, not only at "the sources"', () => {
  const text =
    'It has been noted to influence later work, though the documents do not name what it influenced specifically.'
  assert.ok(measureProse(text).pointsAtSources >= 1)
  assert.ok(measureProse('One document describes the cutting.').pointsAtSources >= 1)
  // Still counted: the phrasings this list already had.
  assert.ok(measureProse('The sources describe it as bleak.').pointsAtSources >= 1)
  // A document IN the film, or a source novel, is not the retrieval.
  assert.equal(measureProse('Its source novel was published in 1978.').pointsAtSources, 0)
})

/**
 * ornith-1.5-9b wrote its paragraph labels into the prose under version 15.
 * The panel draws its own headings from the map, so such a row renders
 * "Context" above the literal text "[tradition]".
 */
test('question labels left in the prose are counted', () => {
  const text = ['[tradition]', 'It adapts a 1978 novel.', '', '[work]', 'The camera stays close.'].join(
    '\n'
  )
  assert.equal(measureProse(text).inlineLabels, 2)
  assert.equal(measureProse('The film adapts a novel.').inlineLabels, 0)
})

/**
 * The names a model reaches for are the ones the retrieval handed it, so they
 * come from the run rather than from a fixed list. Taken from the trailing
 * segment of a page title only: everything before it is the film's own name and
 * its people, who MUST stay nameable.
 */
test('writer names come from source titles, and the film\u2019s own people are not among them', () => {
  const names = writerNamesFromSources([
    { title: 'Requiem for a Dream movie review - Roger Ebert' },
    { title: 'Darren Aronofsky Movies and TV Shows - Reviews & Ratings' },
    { title: 'Requiem for a Dream - Rotten Tomatoes' },
    { title: 'FILM REVIEW; Addicted to Drugs and Drug Rituals' },
    { title: 'REQUIEM FOR A DREAM (2000) - Frame Rated' },
  ])
  assert.ok(names.includes('Roger Ebert'))
  assert.ok(names.includes('Ebert'), 'a surname is how a critic is named in prose')
  assert.ok(names.includes('Rotten Tomatoes'))
  // The director is named in a title and must never enter this list: every
  // version requires naming the people who made the film.
  assert.ok(!names.includes('Darren Aronofsky'))
  assert.ok(!names.includes('Aronofsky'))
  // All-boilerplate tails name nobody, and a title with no separator gives up.
  assert.ok(!names.includes('Reviews & Ratings'))
  assert.ok(!names.some((name) => name.includes('Addicted')))
})

test('a named writer is counted once, and only when capitalised', () => {
  const names = writerNamesFromSources([
    { title: 'Requiem for a Dream movie review - Roger Ebert' },
    { title: 'REQUIEM FOR A DREAM (2000) - Frame Rated' },
  ])
  const surname = measureProse('Connelly took what Ebert called her riskiest role.', null, names)
  assert.equal(surname.namedWriters, 1)
  assert.deepEqual(surname.namedWriterMatches, ['Ebert'])

  // The full name and the surname are one writer, not two.
  const full = measureProse('Roger Ebert called it her riskiest role.', null, names)
  assert.equal(full.namedWriters, 1)
  assert.deepEqual(full.namedWriterMatches, ['Roger Ebert'])

  // Case-sensitive: "Rated" from "Frame Rated" is a name, "rated" is a word.
  assert.equal(measureProse('It went out NC-17 rated.', null, names).namedWriters, 0)

  // Nothing passed means not measured, which is the zero the report prints.
  assert.equal(measureProse('Ebert called it her riskiest role.').namedWriters, 0)
})

/**
 * "Sight and Sound" read as a two-word personal name once the lowercase
 * connective was filtered out, so "Sound" was registered as its surname and
 * matched "Sound is pushed to acute exaggeration" in both version-16 answers.
 * The case-sensitive guard could not help: the word opened a sentence.
 */
test('a publication is registered whole, and never yields a surname', () => {
  const names = writerNamesFromSources([
    { title: 'The best films of 2006 | Sight and Sound' },
    { title: 'Requiem for a Dream movie review - Roger Ebert' },
  ])
  assert.ok(names.includes('Sight and Sound'), 'the connective is kept')
  assert.ok(!names.includes('Sight Sound'), 'and the mangled form is gone')
  assert.ok(!names.includes('Sound'))
  // A name capitalised throughout still gives its surname, which is how a
  // critic gets named in prose.
  assert.ok(names.includes('Roger Ebert') && names.includes('Ebert'))
  assert.equal(measureProse('Sound is pushed to exaggeration.', null, names).namedWriters, 0)
})

/**
 * Publications are printed beside every blurb on an aggregator page, so an
 * answer names them without any source TITLE having supplied one. On the
 * version-16 bench one answer named six in a paragraph while this column,
 * reading titles alone, reported two.
 */
test('a publication named out of a document body is counted', () => {
  const named =
    'The Chicago Sun-Times and Philadelphia Inquirer both call it chilling, and the Washington Post says the style pistol-whips attention.'
  const signals = measureProse(named, null, [])
  assert.equal(signals.namedWriters, 3)
  assert.deepEqual(signals.namedWriterMatches.sort(), [
    'Chicago Sun-Times',
    'Philadelphia Inquirer',
    'Washington Post',
  ])
})

/**
 * Two shapes that name a writer and CANNOT name a maker - a maker is never "of"
 * a publication, nor "the reviewer at" one. That is the whole reason they are
 * shapes and not a bare surname plus a reporting verb, which would fire on
 * "Aronofsky said" and on "Selby wrote", both of which every version requires.
 */
test('a writer attached to a publication is counted, and a maker never is', () => {
  const writer = measureProse('Gayle Sequeira of Filmstage notes that time speeds up.', null, [])
  assert.equal(writer.namedWriters, 1)
  const at = measureProse('The reviewer at Horrornews traces the collapse.', null, [])
  assert.equal(at.namedWriters, 1)

  const makers = measureProse(
    'Aronofsky said the film is about addiction in general, and Selby wrote the novel in 1978.',
    null,
    writerNamesFromSources([{ title: 'Requiem for a Dream - Wikipedia' }])
  )
  assert.equal(makers.namedWriters, 0, 'naming the people who made it is required, never counted')
})

/**
 * Two false positives measured on the Suspiria bench, both film titles.
 * "Suspiria" came from "The Film Stage Show Classic - Suspiria (1977)", where
 * the film's own name sits where a byline goes. "Mother of Tears" matched the
 * "X of Y" shape written for "Gayle Sequeira of BFI notes".
 */
test("the film's own name is never a writer, wherever a site puts it", () => {
  const sources = [
    { title: 'The Film Stage Show Classic - Suspiria (1977)' },
    { title: 'Suspiria (Dario Argento, 1977) - Offscreen' },
  ]
  assert.ok(writerNamesFromSources(sources).includes('Suspiria'), 'unguarded, it is a name')
  const guarded = writerNamesFromSources(sources, ['Suspiria'])
  assert.ok(!guarded.includes('Suspiria'))
  assert.ok(guarded.includes('Offscreen'), 'and the real one survives')
})

test('a film title shaped like "X of Y" is not a critic of a publication', () => {
  // No reporting verb: a title, not an attribution.
  assert.equal(measureProse('Inferno and Mother of Tears extended the trilogy.').namedWriters, 0)
  assert.equal(measureProse('It opens on the Village of the Damned.').namedWriters, 0)
  // With the verb, it is the measured case and still counts.
  const hit = measureProse('Gayle Sequeira of Filmstage notes that time speeds up.')
  assert.equal(hit.namedWriters, 1)
  assert.equal(measureProse('Douglas Buck at Offscreen judged it a work of art.').namedWriters, 1)
})

/**
 * Every version since 8 asks for a question's answer to be one unbroken run.
 * Measured on the Suspiria bench: paragraph 3 labelled "work+circumstances",
 * paragraph 6 "circumstances", two work paragraphs in between.
 */
test('an answer split across non-adjacent paragraphs is counted', () => {
  const split = [['tradition'], ['tradition'], ['work', 'circumstances'], ['work'], ['work'], ['circumstances']]
  assert.equal(measureProse('a\n\nb\n\nc\n\nd\n\ne\n\nf', split).scattered, 1)

  const clean = [['tradition'], ['work'], ['work'], ['circumstances'], ['reception']]
  assert.equal(measureProse('a\n\nb\n\nc\n\nd\n\ne', clean).scattered, 0)

  // Two questions sharing a paragraph is allowed and is not a split.
  const shared = [['tradition', 'work'], ['work'], ['reception']]
  assert.equal(measureProse('a\n\nb\n\nc', shared).scattered, 0)

  assert.equal(measureProse('a\n\nb').scattered, 0, 'no map, not measured')
})

/**
 * The critics a run actually handed the model, which on an aggregator-heavy
 * retrieval are all in the document BODIES and none in the titles.
 *
 * Measured on the Suspiria bench: an answer named five and the report counted
 * one, the only hit being the publication that happened to be in the
 * hand-written list. Every fixture here is verbatim page text from that run.
 */
test('bylines and credited links are the names this run handed the model', () => {
  const metacritic = [
    '[100',
    '',
    'RogerEbert.com](/publication/rogerebertcom/)',
    '',
    'Suspiria truly is one of the absolute classics of the horror genre.',
    '',
    '[By Peter Sobczynski](/critic/peter-sobczynski/)[FULL REVIEW](https://www.rogerebert.com/x)',
    '',
    '[100',
    '',
    'Empire](/publication/empire/)',
    '',
    '[Washington Post](/publication/washington-post/)',
    '[By Gary Arnold](/critic/gary-arnold/)[FULL REVIEW](https://www.washingtonpost.com/x)',
    '[The New York Times](/publication/the-new-york-times/)',
    '[By Janet Maslin](/critic/janet-maslin/)[FULL REVIEW](http://www.nytimes.com/x)',
  ].join('\n')
  const deepFocus = '#### By Brian Eggert | October 28, 2018'

  const names = namesFromDocuments([metacritic, deepFocus])
  for (const name of ['Peter Sobczynski', 'Gary Arnold', 'Janet Maslin', 'Brian Eggert', 'Empire']) {
    assert.ok(names.includes(name), name + ' is a name this run supplied')
  }
})

/**
 * A SITE-NAME IS USED AS A PERSON, and that is the misattribution the rule
 * names: the document carries "RogerEbert.com" over a review bylined Peter
 * Sobczynski, and the answer wrote "Roger Ebert called it an absolute classic".
 */
test('a run-together site name is registered the way an answer writes it', () => {
  const names = namesFromDocuments(['[RogerEbert.com](/publication/rogerebertcom/)'])
  assert.ok(names.includes('Roger Ebert'))
})

/**
 * THE SAFETY PROPERTY, and the reason this reads bylines rather than a surname
 * plus a reporting verb: a director is never bylined on a review of their own
 * film and never filed under /critic/, so the makers stay nameable.
 */
test('the film’s own makers are never read as critics', () => {
  const page = [
    'Directed By:[Dario Argento](/person/dario-argento/)',
    '',
    'Written By:[Dario Argento](/person/dario-argento/), [Daria Nicolodi](/person/daria-nicolodi/)',
    '',
    'Cast',
    '',
    '[Jessica Harper](https://www.deepfocusreview.com/actor/jessica-harper/)',
    '',
    '[Dario Argento](https://www.deepfocusreview.com/director/dario-argento/)',
  ].join('\n')
  const names = namesFromDocuments([page])
  assert.deepEqual(
    names.filter((name) => name.includes('Argento') || name.includes('Nicolodi') || name.includes('Harper')),
    []
  )
})

/** A byline naming nobody is not a name. */
test('an uncredited byline contributes nothing', () => {
  assert.deepEqual(namesFromDocuments(['By Staff (Not Credited)']), [])
})

/**
 * A SINGULAR VIEWER IS THE PROMPT'S OWN PHRASING, and counting it reported the
 * instruction being obeyed as a fault.
 *
 * Measured on the second Suspiria bench: deepseek-v4.1-flash scored spill 7 and
 * all seven were "a viewer" in the answers version 16 asks for it in - "say
 * what that does to a viewer sitting in front of it". The exclusion used to be
 * on "the viewer", calibrated against version 13's wording.
 */
test('a single viewer is how the prompt asks for an effect, not a spilled view', () => {
  const sections = [['work'], ['reception']]
  const clean = [
    'The camera takes a perspective belonging to nobody on screen, so a viewer has no safe avatar. That jolt pulls a viewer out of one dread state and into another. The viewer starts scanning ordinary details for menace.',
    'Critics valued the colour and faulted the plot.',
  ].join('\n\n')
  assert.equal(measureProse(clean, sections).spill, 0)

  // Plural is audience response, which is what this exists to catch, and a
  // named critic outside reception is the original fault.
  const spilled = [
    'Some viewers find the plot thin, and one critic likens it to watching a stage.',
    'Critics valued the colour and faulted the plot.',
  ].join('\n\n')
  assert.equal(measureProse(spilled, sections).spill, 2)
})

/**
 * The longest paragraph in WORDS. Version 16 states a hundred-word anchor and
 * flags one half as long again, and only sentences were counted - so a set of
 * paragraphs inside the sentence cap and carrying 150 words each read clean.
 */
test('a paragraph is measured in words as well as sentences', () => {
  const short = 'One short sentence here. Another short one. A third.'
  const heavy = 'A sentence. ' + Array.from({ length: 160 }, () => 'word').join(' ') + '.'
  const signals = measureProse([short, heavy].join('\n\n'))
  assert.equal(signals.longestParagraph, 3)
  assert.ok(signals.longestParagraphWords > 150, String(signals.longestParagraphWords))
  assert.equal(measureProse('').longestParagraphWords, 0)
})

/**
 * An aggregator credits a critic beside a DATE, with no byline and no link -
 * which is how Rotten Tomatoes writes every card, and neither shape above can
 * see it. Measured on the second Suspiria bench, where one answer named four
 * critics, every attribution was correct, and the report counted zero.
 */
test('a critic credited beside a date is a name this run supplied', () => {
  const rottenTomatoes = [
    ' Alyx Vesey Bitch Media Jan 7, 2021',
    '',
    'Go to Full Review Adam Nayman The Ringer Oct 5, 2018',
    '',
    'Go to Full Review Christy Lemire ChristyLemire.com Apr 16, 2018',
    '',
    'Go to Full Review Max Allen Horror Movie Talk Sep 23, 2025',
  ].join('\n')
  const names = namesFromDocuments([rottenTomatoes])
  for (const critic of ['Alyx Vesey', 'Adam Nayman', 'Christy Lemire', 'Max Allen']) {
    assert.ok(names.includes(critic), critic)
  }
  // The publication half is kept too, since an answer may name either.
  assert.ok(names.includes('The Ringer'))
  assert.ok(names.includes('Bitch Media'))
})

/**
 * The boilerplate between cards is capitalised, so it joins the run in front of
 * the name: without the lead-noise trim this yields "Review Adam" and "Nayman
 * The Ringer", and neither can match what an answer wrote.
 */
test('an aggregator’s own furniture is not read as part of a name', () => {
  const names = namesFromDocuments(['Go to Full Review Adam Nayman The Ringer Oct 5, 2018'])
  assert.ok(names.includes('Adam Nayman'))
  assert.deepEqual(names.filter((n) => /Review|Full|^Go/.test(n)), [])
})

/** A dated line that credits nobody contributes nothing. */
test('a release date is not a byline', () => {
  assert.deepEqual(namesFromDocuments(['Release Date (Theaters)\n\nFeb 1, 1977, Original']), [])
})
