/**
 * The instructions a Watcher Identity is written under -- one copy for films and
 * TV, so the two identities cannot drift into two registers.
 *
 * Version 1 (unversioned) asked for a "viewer personality profile" with three
 * coined "Core Traits", banned every title, and fed the model a lookup table
 * instead of a record. It produced a horoscope: "stories that balance emotional
 * resonance with intellectual stimulation", "you don't just watch -- you feel".
 *
 * Version 2 answered that by banning interpretation. Every sentence had to name
 * a title or a number, the text was capped at 180 words as a list of
 * "Patterns", and the model was confined to what someone watches rather than
 * what the films share. It obeyed and recited the evidence back -- "48% of your
 * films against 16% of the library", "New Zealand at 5.1x" -- a spreadsheet in
 * place of a horoscope, and no more an analysis (F-129).
 *
 * Version 3 asks for the analysis: what ties the choices together, read from the
 * evidence and from what the model knows about the titles it names. The figures
 * are there for the model to see what is unusual; at most two reach the reader.
 * The one test that rules out both earlier failures is written into the rules:
 * a claim must be specific enough to be false for most viewers.
 *
 * The examples offered as right use placeholders, never real names -- a model
 * imitating an example will otherwise put that example's director into an
 * identity for someone who never watched them.
 *
 * Bump TASTE_SYNOPSIS_PROMPT_VERSION whenever this text OR the evidence it reads
 * (tasteEvidence.ts) changes what an identity would say. The refresh gate
 * rewrites every stored identity with an older version on that viewer's next
 * recommendation run that proceeds.
 */

import type { TasteMediaType } from './tasteEvidence.js'

export const TASTE_SYNOPSIS_PROMPT_VERSION = 3

const NOUNS: Record<
  TasteMediaType,
  {
    kind: string
    singular: string
    plural: string
    person: string
    people: string
    completion: string
  }
> = {
  movie: {
    kind: 'film',
    singular: 'film',
    plural: 'films',
    person: 'director',
    people: 'directors',
    completion: 'which films they start and leave unfinished',
  },
  series: {
    kind: 'TV',
    singular: 'show',
    plural: 'shows',
    person: 'network',
    people: 'networks',
    completion: 'how far they get into each show',
  },
}

export function buildTasteSynopsisSystemPrompt(mediaType: TasteMediaType): string {
  const n = NOUNS[mediaType]

  const howYouWatch =
    mediaType === 'series'
      ? `
### How you watch
One or two points on which shows they finish, keep up with or drop, and what those shows have in common (length, format, kind of story). Leave this section out if the evidence says too little.
`
      : ''

  return `You are writing an analysis of one person's ${n.kind} taste, addressed to them as "you". It is shown on their profile and handed to other AI features as the summary of their taste.

The evidence is their viewing record compared with the library they choose from: what they pick more and less often than it offers, the ${n.plural} behind each pattern, how they rate, and ${n.completion}. Your job is to read it: work out what ties their choices together and say it clearly.

Use exactly this structure:

### In short
Two or three sentences naming the taste that runs through their ${n.plural}: the kind of ${n.singular} they choose, its tone and what it tends to be about, grounded in a few titles.

### What connects your choices
Three or four points. Each names one thread running through their ${n.plural} (a tone, a subject, a way of telling a story, a kind of ${n.person}), says what those titles share, and names them.
${howYouWatch}
### How you judge
One or two points on what their ratings reveal: the ${n.plural} they value above or below the consensus, and what those ${n.plural} have in common. Leave this section out if they have rated too few titles to say.

Rules:
- Interpret the evidence, don't recite it. The figures are there so you can see what is unusual. Use at most two of them in the whole text, only where the figure is itself the point, and never write ratios or pairs of percentages.
- Say what the titles have in common. Use what you know about the named ${n.plural} (tone, subject, style, who made them): that is the analysis. Name only titles that appear in the evidence.
- Every claim must be specific enough that it would be false for most viewers. "You like stories with emotional depth" could describe anyone; cut a sentence like that or make it specific.
- Look for what links separate patterns: a subject, tone or approach that shows up across genres, decades and ${n.people}. That is worth more than reporting each pattern on its own.
- Ignore a pattern that one franchise or one ${n.person} explains by itself. Production countries include co-producers and filming locations, so a country is a pattern only when the titles really come from that country's own ${n.kind} culture.
- Describe their taste, not their personality: no feelings, moods, motives or life circumstances.
- The evidence records nothing about when they watch, in what sittings, or how often they rewatch. Say nothing about any of it.
- No invented labels or trait names, no superlatives, and no filler about variety or balance. If the evidence is thin or little distinguishes them, say so plainly and write less.
- 200 to 300 words, in plain language. Bold at most one short phrase per point.

Wrong (vague): "You are drawn to stories that balance emotional resonance with intellectual stimulation." "You don't just watch, you feel."
Wrong (recited): "You choose 2020s ${n.plural} far more than the library offers: 48% of yours against 16% of the library." "Science fiction, mystery and horror each run about 1.6 to 1.7 times their library share."
Right: "Your comedies are rarely gentle: [title], [title] and [title] find their laughs in [what they share], and the same appetite for [quality] runs through the horror you pick." "You rate [kind of ${n.singular}] well above the consensus and [kind of ${n.singular}] below it, as [title] and [title] show."`
}
