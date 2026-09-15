/**
 * The instructions a Watcher Identity is written under -- one copy for films and
 * TV, so the two identities cannot drift into two registers.
 *
 * The first prompt (unversioned, now version 1) asked for a "viewer personality
 * profile" in the second person with three coined "Core Traits", banned every
 * title, and fed the model a lookup table instead of a record. It produced text
 * that could describe anyone: "stories that balance emotional resonance with
 * intellectual stimulation", "you don't just watch -- you feel", rewatches
 * "driven by comfort and nostalgia" for a viewer whose rewatch figure measured
 * nothing. F-129 traces each of those sentences to its source.
 *
 * This version asks for the opposite on every axis: what distinguishes the
 * viewer from their library, stated with the titles and names that show it, and
 * nothing the evidence cannot support. The examples it offers the model use
 * placeholders, never real names -- a model imitating an example will otherwise
 * put that example's director into an identity for someone who never watched
 * them.
 *
 * Bump TASTE_SYNOPSIS_PROMPT_VERSION whenever this text OR the evidence it reads
 * (tasteEvidence.ts) changes what an identity would say. The refresh gate
 * rewrites every stored identity with an older version, and nothing else carries
 * a prompt change to a viewer whose taste profile has not moved.
 */

import type { TasteMediaType } from './tasteEvidence.js'

export const TASTE_SYNOPSIS_PROMPT_VERSION = 2

const NOUNS: Record<
  TasteMediaType,
  { plural: string; kind: string; person: string; completion: string }
> = {
  movie: {
    plural: 'films',
    kind: 'film',
    person: 'director',
    completion: 'what they start and leave unfinished',
  },
  series: {
    plural: 'shows',
    kind: 'TV',
    person: 'network',
    completion: 'how far they get into a show',
  },
}

export function buildTasteSynopsisSystemPrompt(mediaType: TasteMediaType): string {
  const n = NOUNS[mediaType]

  return `You are writing a short, factual account of one person's ${n.kind} viewing, addressed to them as "you". It is shown on their profile and handed to other AI features as the summary of their taste, so it has to be accurate before it is interesting.

The evidence is their viewing record compared with the library they choose from.

Use exactly this structure:

### What stands out
Two to four sentences on what most distinguishes their ${n.plural} from what the library offers them. Lead with the single strongest pattern.

### Patterns
Three to five bullet points. Each is one concrete observation from the evidence (a genre, an era, a country, a ${n.person}, a recurring subject, how they rate, or ${n.completion}) with the titles or names that show it.

Rules:
- Every sentence must rest on the evidence and should name what it rests on: a title, a name, a country, a subject or a number. A sentence that cannot point to the evidence gets cut.
- A preference means choosing something more or less often than the library offers it. A genre can be a large share of their ${n.plural} and still be no larger than its share of the library; that is not a preference and must not be described as one.
- Make each point with titles and names from the evidence. Do not bring in titles that are not in it: the evidence is a sample of their history, not all of it.
- Describe what they watch and how they rate it, not who they are. No personality, feelings or motives, and nothing about what they "crave", "seek", "connect with" or are "drawn to".
- The evidence records nothing about when they watch, in what sittings or moods, or how often they rewatch. Say nothing about any of it.
- No invented labels or trait names, no superlatives, and no filler about variety, balance or range. Leave out any area without a clear pattern. If little distinguishes them overall, say so in one plain sentence.
- Keep numbers light: one or two per bullet at most, rounded. The reader wants the pattern, not the table.
- Under 180 words in total. Bold at most one short phrase per bullet.

Wrong: "You are drawn to stories that balance emotional resonance with intellectual stimulation." "You don't just watch, you feel." "Your rewatches are driven by comfort and nostalgia."
Right: "You pick [country] ${n.plural} at about three times the library's rate, and [name] and [name] account for [number] of them." "You rate [genre] well below IMDb: [title] got [rating] against its [crowd rating]."`
}
