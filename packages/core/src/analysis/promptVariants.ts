/**
 * Prompt variants: alternative questions and rules that sit BESIDE a version
 * rather than after it.
 *
 * WHY THESE EXIST. A version is a decision about what every stored analysis in
 * the library should say, and bumping one retires all of them. A variant is a
 * different question: what to send a model that cannot hold the current prompt.
 * Measured on Fear and Loathing in Las Vegas under version 15, `ornith-1.5-9b`
 * wrote 405 words with ONE paragraph on what the film is doing and TWO on its
 * reception - the one proportion the prompt states as a hard cap - dropped the
 * performances, the sound and the cutting entirely, promoted a student essay
 * site to "one reading held", and ran a list of camera bodies and film stocks.
 * None of that is disobedience. Version 15's rules are ~1,900 words of mostly
 * conditional instruction, and a 9B model reads the first clause of a long
 * conditional and loses the rest - the same failure, one size down, that
 * version 8 recorded for an abstract rule against a named phrasing.
 *
 * SO A VARIANT IS NOT A DRAFT. A draft is the next version, benched before it
 * retires the library. A variant is never promoted and never becomes current:
 * it is a second prompt for a second class of model, and both stay.
 *
 * IT IS THE SAME SHAPE AS AN EDITION, deliberately - only questions and rules,
 * so everything above the TASK line and the whole output contract are byte-for
 * byte what every other prompt sends. That is what lets the bench put a variant
 * beside its base version on one retrieval and attribute the difference to the
 * prompt. `prompt.test.ts` pins it.
 *
 * IT KEEPS ITS BASE VERSION'S QUESTION IDS, which is not decoration: the
 * paragraph map is parsed against `questionIdsFor(mediaType, version)`, so a
 * variant that renamed a question would have every label discarded and every
 * label-derived signal read as unmeasured.
 *
 * THE LIBRARY MAY WRITE WITH ONE, UNDER TWO CONDITIONS. It is opt-in per
 * instance on the Title Analysis role (`ProviderConfig.analysisPromptVariant`),
 * and `title_analysis.prompt_variant` (0180) records which prompt wrote each
 * row - without that column the library holds two kinds of article under one
 * version number and nothing can tell them apart. The second condition is
 * `libraryVariantFor`'s: a variant may only write while its base IS the current
 * version, or a row would file one version's questions under another's number.
 *
 * SWITCHING THE SETTING RETIRES NOTHING. Staleness is still the version number
 * alone, so a library written under the version's own prompt stays current when
 * the setting moves, and the two kinds coexist until something else rewrites
 * them. That is the deliberate trade for an optional setting: retiring every
 * stored analysis is what a version bump is for.
 *
 * PURE AND DB-FREE, like ./promptEditions.ts beside it.
 */
import type { PromptVariant } from './prompt.js'

/**
 * Short rules, counted budgets, flat bans - written for a small local model.
 *
 * Every difference from version 15 answers something measured on that bench
 * rather than something imagined:
 *
 * - THE QUESTIONS CARRY BUDGETS. "Length follows the work" plus "reception is
 *   never longer than the work answer" is two judgements about proportion made
 *   at the end of a long prompt. A paragraph count per question is one
 *   instruction that can be followed while writing.
 * - THE WORK QUESTION NAMES WHERE TO LOOK. Image, cutting, sound, performance,
 *   attention. The thin answer was not a refusal to write, it was a model that
 *   stopped after the first thing it found.
 * - A MAKER'S ACCOUNT OF WHAT THE FILM DOES BELONGS TO THE WORK ANSWER. The
 *   sentence in those documents that best described the film's effect was the
 *   director's own, and all three benched models filed it under making,
 *   correctly, because that is where version 15 puts a maker's statement - so
 *   the work answers were left with an AI encyclopedia's glosses instead.
 * - AN ENCYCLOPEDIA'S OWN EFFECT CLAIMS ARE NOT EVIDENCE. Version 15 licenses
 *   any effect "a document describes", and on that bench the richest effect
 *   language in the source set belonged to a generated encyclopedia that also
 *   got four checkable facts wrong. The two rules pulled opposite ways; here
 *   the source rule is stated inside the same sentence as the licence.
 * - THE BANNED HEDGES INCLUDE THE ONES IT REACHED FOR. "Has come to be regarded
 *   as" is the periphrasis it used where version 15 named "is regarded as".
 * - IT COUNTS ITS PARAGRAPHS BEFORE WRITING THE MAP. A map one line short
 *   silently shifts every label after the miscount, which is worse than a map
 *   that is rejected outright, because a rejected one says so.
 */
const COMPACT_VARIANT: PromptVariant = {
  id: 'compact',
  label: 'Compact',
  base: 15,
  note: 'Short rules, per-question paragraph budgets and flat bans, for small local models that lose long conditional instructions. Written against ornith-1.5-9b on version 15.',
  movieQuestions: [
    {
      id: 'tradition',
      text: "Where does this film come from? Say what kind of work it is and what it adapts or draws on. Name a tradition, movement or body of work only if a document places it in one - inventing a movement to fill the slot is worse than naming none. Do not open on who directed, wrote or starred in it - the reader can already see the credits - and never copy the genre labels or mood tags a listing page attaches. Do not name one earlier film as this one's model: that is a critic's view, it belongs in the reception answer, and it can give away how this film ends.",
    },
    {
      id: 'work',
      text: "What is this film doing, and how? Go through the choices that matter and give each one a sentence naming it: what the camera and the light do, what the cutting and the sound do, what the performances do, and how the film holds a viewer's attention. Then, only if a document describes what that choice does to a viewer, say that as well, in your own words. If no document says what a choice does, stop after naming the choice - never supply an effect yourself, however obvious it seems, and watch the phrases that smuggle one in: \"so that\", \"which gives\", \"lets it\", \"the result is\". Where a maker describes what the film does to a viewer, use it here. Never list camera bodies, lens names, film stocks or song titles. Say what an image or a figure does to a viewer, never what it turns out to be, and leave out whether any of it is good.",
    },
    {
      id: 'circumstances',
      text: "How was it made, and what did that leave on the film? Two things belong here and nothing else. First, what a maker said they were trying to do: they must be quoted or reported as saying it, and a page describing a director's aims without quoting them does not count. Second, a condition of the making or the first release that changed the film - ask whether it would be a different film, or would have reached its audience differently, if this had not happened, and drop it if the answer is no. Money, rights, schedules, job lists, crew and extras counts, filming locations and release dates all fail that test. How the film was received is not a making fact, and neither is what anyone went on to do afterwards.",
    },
    {
      id: 'reception',
      text: "How was the film received? One paragraph, and never longer than what you wrote about the film itself. Put everyone who made the same point into one sentence - \"critics praised the effects\" once, not a sentence for each critic who did. One sentence may give a reading of what the film means, if a critic's reading shaped how the film was taken, and ordinary viewers get one sentence at most. Add a second paragraph only if a document names what this film influenced: if you cannot name the thing it influenced, write nothing about influence at all. Lead with criticism and scholarship where the documents carry them. No scores of any kind, no awards, no verdict of your own, and nothing about what happens in any part of the film.",
    },
  ],
  seriesQuestions: [
    {
      id: 'tradition',
      text: "Where does this series come from? Say what kind of work it is and what it adapts or draws on. Name a tradition, movement or body of work only if a document places it in one - inventing a movement to fill the slot is worse than naming none. Do not open on who created, wrote or starred in it - the reader can already see the credits - and never copy the genre labels or mood tags a listing page attaches. Do not name one earlier work as this one's model: that is a critic's view, it belongs in the reception answer, and it can give away how this one ends.",
    },
    {
      id: 'work',
      text: "What is this series doing, and how? Go through the choices that matter and give each one a sentence naming it: what the camera and the light do, what the cutting and the sound do, what the performances do, and how an episode holds a viewer's attention. Then, only if a document describes what that choice does to a viewer, say that as well, in your own words. If no document says what a choice does, stop after naming the choice - never supply an effect yourself, however obvious it seems, and watch the phrases that smuggle one in: \"so that\", \"which gives\", \"lets it\", \"the result is\". Where a maker describes what the series does to a viewer, use it here. Never list camera bodies, lens names, film stocks or song titles. Say what an image or a figure does to a viewer, never what it turns out to be, and leave out whether any of it is good.",
    },
    {
      id: 'structure',
      text: "How is it built across its run - one continuing story or separate episodes, and did that change?",
    },
    {
      id: 'circumstances',
      text: "How was it made, and what did that leave on the series? Two things belong here and nothing else. First, what a maker said they were trying to do: they must be quoted or reported as saying it, and a page describing a creator's aims without quoting them does not count. Second, a condition of the making or the first broadcast that changed the series - ask whether it would be a different series, or would have reached its audience differently, if this had not happened, and drop it if the answer is no. Money, rights, schedules, job lists, crew and extras counts, filming locations and air dates all fail that test. How it was received is not a making fact, and neither is what anyone went on to do afterwards.",
    },
    {
      id: 'reception',
      text: "How was the series received? One paragraph, and never longer than what you wrote about the series itself. Put everyone who made the same point into one sentence - \"critics praised the effects\" once, not a sentence for each critic who did. One sentence may give a reading of what it means, if a critic's reading shaped how it was taken, and ordinary viewers get one sentence at most. Add a second paragraph only if a document names what this series influenced: if you cannot name the thing it influenced, write nothing about influence at all. Lead with criticism and scholarship where the documents carry them. No scores of any kind, no awards, no verdict of your own, and nothing about what happens in any part of it.",
    },
  ],
  rules: [
    "Describe how it works, never what happens in it. No endings, no reveals, nothing about what a character, creature or image turns out to be, and nothing about a changed ending or which character gets out. Someone who has not seen it must be able to read this safely.",
    "Write five to nine paragraphs, 450 to 750 words in all, separated by blank lines. Spend one or two paragraphs on where it comes from, up to four on what it is doing - as many as the documents support and no more - one or two on how it was made, and one on how it was received, which is the last thing in the piece. Every paragraph is three or four sentences: the first makes one claim and the rest support it.",
    "Answer the questions in the order given, and keep each answer in one unbroken run of paragraphs. Say each fact once, under the question it belongs to - if you have written it already, do not write it again under another question. Leave out a question the documents cannot answer, which is the right outcome and not a gap, and if none of them can be answered, say so in two sentences and stop.",
    "Write every sentence in your own words. Never copy a phrase out of a document: anything reading like a crew note, a caption or a list of items has to be turned into English first. Say what a choice does, not what it avoids, so no \"rather than\" and no \"not X but Y\". No semicolons. Plain prose only - no headings, no bullet points, no numbered lists, no bold.",
    "Open each answer with a fact about the work. Never open by announcing what the answer covers - not \"The film sits in\", not \"Critics disagree about\", and not a sentence saying that the making left its mark on the work.",
    "Name the person who made the choice you are describing - the director, the writer, the cinematographer - never \"the creative team\". Name a person for what they chose, never to record what their job was. Cut any sentence whose only content is that the work belongs to a tradition or influenced something.",
    "The first answers speak in your own voice: state facts and what is on screen plainly, with nobody attached, even where a critic is who you read it from. Opinions belong in the reception answer, and every opinion has a person behind it - \"a critic\", \"a scholar\", \"a reviewer\", \"some viewers\" - never \"a reading\", \"an account\" or \"the press\". Never hide an opinion inside \"is regarded as\", \"has come to be regarded as\", \"is described as\", \"has been called\", \"is said to\" or \"reportedly\". Never name a critic, a scholar or a publication. \"Critics\" means more than one critic, and two remarks by one critic are one critic.",
    "Weigh each document by who is speaking in it. A review or essay arguing a case about this title is evidence, and so is a critic quoted anywhere. A fan page, a user review, a study guide, a student essay, a store or streaming listing, and an encyclopedia's own summary of what critics think are not: they can confirm a plain fact, they give no reading and no placement, and their descriptions of what it does to a viewer are not evidence that it does it. If a document gets a plain fact wrong - who made it, when, or where - take nothing from that document.",
    "Never mention the documents. The reader cannot see them, so \"the sources say\", \"the sources describe\" and \"one source credits\" point at nothing. Do not quote the reception figures back.",
    "Count the paragraphs you have written before writing the map, and give the map one line for every one of them.",
  ],
}

/**
 * Every variant this build carries, in the order the picker offers them.
 *
 * A variant is selectable on the bench and nowhere else. Adding one means
 * adding it here; nothing else enumerates them.
 */
export const PROMPT_VARIANTS: readonly PromptVariant[] = [COMPACT_VARIANT]
