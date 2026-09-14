/**
 * Earlier prompt editions, kept so the bench can put them beside the current one.
 *
 * WHY THESE EXIST. The analysis bench compares prompt versions as well as
 * models, from ONE retrieval: every selected version is built from the same
 * documents and every selected model answers each. That needs the older
 * questions and rules to still be in the code. The library job never reads
 * this file - it always writes with the current edition in ./prompt.ts.
 *
 * AN EDITION IS ONLY ITS QUESTIONS AND RULES. The header, the source block, the
 * TASK lines, the retrieval-mode rule and the output contract are identical
 * across every version listed here - checked when these were extracted, by
 * rendering each version's own prompt.ts from git history and comparing every
 * other line. A future version that changes one of those shared parts cannot be
 * archived as an edition of this shape; it needs that part added to the shape
 * first.
 *
 * GENERATED, NOT HAND-COPIED. The strings were read back out of each version's
 * rendered prompt, so they are byte-for-byte what that version sent. Do not edit
 * them: a "fixed" archived edition is no longer the version its number names,
 * and every stored bench run labelled with it would be mislabelled.
 *
 * To archive the current edition when the next version ships, add it here with
 * its questions and rules exactly as they stand, then change ./prompt.ts.
 */
import type { PromptEdition } from './prompt.js'

export const ARCHIVED_PROMPT_EDITIONS: readonly PromptEdition[] = [
  {
    version: 7,
    movieQuestions: [
      { id: 'work', text: "What is this film doing, and how do its choices serve that? Name a choice, then say what it achieves - a list of equipment or techniques with no effect attached is not an answer." },
      { id: 'tradition', text: "What tradition does it sit in - what was it responding to, what did it influence? Name traditions and movements freely. Naming one specific prior work as the model for this one is only safe when the comparison does not carry the ending of that work across: if a reader who knows how that one ends would then know how this one ends, name the tradition and stop there." },
      { id: 'intent', text: "What did the people who made it say they were trying to do?" },
      { id: 'circumstances', text: "What circumstances of its making or first release left a mark on the work - how it was produced, the form it was originally shown in, constraints or controversies that changed what it became? Facts that did not change the work - budgets, shooting schedules, crew and extras counts, release dates - are not answers." },
      { id: 'dispute', text: "What do critics genuinely disagree about? Report the disagreement and leave it open - if you find yourself concluding which side is right, you have stopped answering this question." },
    ],
    seriesQuestions: [
      { id: 'work', text: "What is this series doing, and how do its choices serve that? Name a choice, then say what it achieves - a list of equipment or techniques with no effect attached is not an answer." },
      { id: 'structure', text: "How is it structured across its run - serialised or episodic, and did it change?" },
      { id: 'tradition', text: "What tradition does it sit in - what was it responding to, what did it influence? Name traditions and movements freely. Naming one specific prior work as the model for this one is only safe when the comparison does not carry the ending of that work across: if a reader who knows how that one ends would then know how this one ends, name the tradition and stop there." },
      { id: 'intent', text: "What did the people who made it say they were trying to do?" },
      { id: 'circumstances', text: "What circumstances of its making or first release left a mark on the work - how it was produced, the form it was originally shown in, constraints or controversies that changed what it became? Facts that did not change the work - budgets, shooting schedules, crew and extras counts, release dates - are not answers." },
      { id: 'dispute', text: "What do critics genuinely disagree about? Report the disagreement and leave it open - if you find yourself concluding which side is right, you have stopped answering this question." },
    ],
    rules: [
      "Describe how it works, never what happens in it. No third-act or ending discussion. Someone who has not seen it must be able to read this safely.",
      "Match your register to the work. A stunt-driven action picture has real craft in its staging and choreography, and that is a legitimate subject - write about it as what it is. Do not apply art-cinema vocabulary to a genre entertainment.",
      "The questions are what to cover and in what order, not a form to fill in. Do not write one paragraph per question. Merge the ones that belong together and let the whole read as continuous prose with a single line of thought.",
      "Write in short paragraphs of three or four sentences, separated by a blank line. Keep each sentence to one idea and do not chain clauses with semicolons - if a sentence carries two ideas, make it two sentences. Plain prose only in the analysis itself: no headings, bullet points, numbered lists or bold text.",
      "Be specific. Name the people the sources name - the director, the writer, the cinematographer, whoever is credited with the choice you are describing - rather than writing \"those behind the project\" or \"the creative team\". Cut any sentence whose only content is that the work sits in a tradition, extends one, or hopes to influence something: say what and how, or say nothing.",
      "Answer only what the sources genuinely support. It is normal for two or three of these questions to have no answer, and dropping them is the correct outcome rather than a gap to fill. If none of them do, say so in two sentences and stop.",
      "Do not cite, number or link the sources in your prose, and do not quote the reception figures back.",
      "Length follows the work and the sources. Some support 900 words. Many support 200.",
    ],
  },
  {
    version: 8,
    movieQuestions: [
      { id: 'work', text: "What is this film doing, and how do its choices serve that? Name a choice, then say what it achieves - a list of equipment or techniques with no effect attached is not an answer." },
      { id: 'tradition', text: "What tradition does it sit in - what was it responding to, what did it influence? Name traditions and movements freely. Naming one specific prior work as the model for this one is only safe when the comparison does not carry the ending of that work across: if a reader who knows how that one ends would then know how this one ends, name the tradition and stop there." },
      { id: 'intent', text: "What did the people who made it say they were trying to do?" },
      { id: 'circumstances', text: "What circumstances of its making or first release left a mark on the work - how it was produced, the form it was originally shown in, constraints or controversies that changed what it became? Facts that did not change the work - budgets, shooting schedules, crew and extras counts, release dates - are not answers. Neither is how it was received: marketing, online discussion and who objected to it after release belong to the disagreement question, not this one. Ask whether the finished work would be different if this had not happened." },
      { id: 'dispute', text: "What do critics genuinely disagree about? Report the disagreement and leave it open - if you find yourself concluding which side is right, you have stopped answering this question." },
    ],
    seriesQuestions: [
      { id: 'work', text: "What is this series doing, and how do its choices serve that? Name a choice, then say what it achieves - a list of equipment or techniques with no effect attached is not an answer." },
      { id: 'structure', text: "How is it structured across its run - serialised or episodic, and did it change?" },
      { id: 'tradition', text: "What tradition does it sit in - what was it responding to, what did it influence? Name traditions and movements freely. Naming one specific prior work as the model for this one is only safe when the comparison does not carry the ending of that work across: if a reader who knows how that one ends would then know how this one ends, name the tradition and stop there." },
      { id: 'intent', text: "What did the people who made it say they were trying to do?" },
      { id: 'circumstances', text: "What circumstances of its making or first release left a mark on the work - how it was produced, the form it was originally shown in, constraints or controversies that changed what it became? Facts that did not change the work - budgets, shooting schedules, crew and extras counts, release dates - are not answers. Neither is how it was received: marketing, online discussion and who objected to it after release belong to the disagreement question, not this one. Ask whether the finished work would be different if this had not happened." },
      { id: 'dispute', text: "What do critics genuinely disagree about? Report the disagreement and leave it open - if you find yourself concluding which side is right, you have stopped answering this question." },
    ],
    rules: [
      "Describe how it works, never what happens in it. No third-act or ending discussion. Someone who has not seen it must be able to read this safely.",
      "Match your register to the work. A stunt-driven action picture has real craft in its staging and choreography, and that is a legitimate subject - write about it as what it is. Do not apply art-cinema vocabulary to a genre entertainment.",
      "The questions are what to cover and in what order, not a form to fill in. Give a question as many paragraphs as the sources support, and none to a question they do not. Two questions may share a paragraph when they genuinely belong together, but do not scatter one question across paragraphs that are not next to each other. Let the whole read as continuous prose with a single line of thought.",
      "Write in short paragraphs of three or four sentences, separated by a blank line. Keep each sentence to one idea and do not chain clauses with semicolons - if a sentence carries two ideas, make it two sentences. Plain prose only in the analysis itself: no headings, bullet points, numbered lists or bold text.",
      "Be specific. Name the people the sources name - the director, the writer, the cinematographer, whoever is credited with the choice you are describing - rather than writing \"those behind the project\" or \"the creative team\". Cut any sentence whose only content is that the work sits in a tradition, extends one, or hopes to influence something: say what and how, or say nothing.",
      "Answer only what the sources genuinely support. It is normal for two or three of these questions to have no answer, and dropping them is the correct outcome rather than a gap to fill. If none of them do, say so in two sentences and stop.",
      "Do not cite, number or link the sources in your prose, and do not quote the reception figures back. Never refer to the source documents as a thing - no \"the sources say\", \"the sources describe\", \"reportedly\", \"according to reports\". Write the claim as a fact about the work, or name the critic or publication that made it.",
      "Length follows the work, not the amount of source text. Many titles support 200 words, and 900 is the most any of them support. A long source block is not a reason to write more - most of it is plot summary, cast lists and the same facts repeated across pages.",
    ],
  },
]
