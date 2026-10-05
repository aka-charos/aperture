/**
 * Labelled pairs for benchmarking a decision model against the cosine bar.
 *
 * WHERE THE LABELS COME FROM. Every pair below was judged by a person during
 * the two derivations of EVIDENCE_CAUSAL_MIN_COSINE — they are the cases quoted
 * in evidenceStrength.ts, transcribed here as data — plus one pair stating the
 * operator's later rule that a shared actor alone is not a reason. A pair is
 * written pick ← watched, the same direction the insights panel shows them:
 * "Metropolis ← Das Boot" means Das Boot was offered as the reason for
 * Metropolis.
 *
 * WHAT COUNTS AS A REASON here is what the question asks the model: the same
 * director, the same franchise, or a closely shared subject, situation, tone or
 * style. Not a shared genre, era, country, popularity — and not a shared actor
 * by itself.
 *
 * ARGUABLE pairs are shown and never scored. Two careful readings disagree
 * about them, so either answer is defensible, and counting them would let the
 * label decide the score instead of the model. Top Gun: Maverick ← Dead
 * Reckoning is arguable on the operator's call (Tom Cruise, but also one very
 * specific kind of stunt spectacle).
 *
 * The labels are fixed by the people who made them; editing one changes what
 * the benchmark measures, so the scoring test pins the set.
 *
 * No runtime imports: pinned by evidenceBenchmarkPairs.test.ts without a
 * database.
 */
import { EVIDENCE_JUDGMENT_MIN_YES, hasCausalEvidence } from './evidenceStrength.js'

export type BenchmarkLabel = 'yes' | 'no' | 'arguable'

/**
 * Why a pair carries its label, as a key the card translates. `name` fills the
 * director, star or studio into the sentence.
 */
export type BenchmarkReasonKind =
  | 'sameDirector'
  | 'sameFranchise'
  | 'samePremise'
  | 'sameUniverse'
  | 'shownAndWrong'
  | 'looseOnly'
  | 'actorOnly'
  | 'arguableStar'
  | 'arguableStudio'
  /** A pair the operator labelled from the live queue (evidenceLabels.ts). */
  | 'yourLabel'

export interface BenchmarkTitle {
  title: string
  year: number
}

export interface BenchmarkPair {
  id: string
  /**
   * Candidate titles for each side, tried in order. More than one when the
   * library may hold the film under another name (Dekalog, Frau im Mond), and
   * each with its own year, so "Dune" is never Lynch's and "Solaris" is never
   * Soderbergh's.
   */
  pick: BenchmarkTitle[]
  watched: BenchmarkTitle[]
  label: BenchmarkLabel
  reason: { kind: BenchmarkReasonKind; name?: string }
}

const t = (title: string, year: number): BenchmarkTitle => ({ title, year })

export const BENCHMARK_PAIRS: readonly BenchmarkPair[] = [
  // ---- First derivation: what the panel showed as the reason, judged wrong.
  {
    id: 'metropolis-clockwork-orange',
    pick: [t('Metropolis', 1927)],
    watched: [t('A Clockwork Orange', 1971)],
    label: 'no',
    reason: { kind: 'shownAndWrong' },
  },
  {
    id: 'metropolis-das-boot',
    pick: [t('Metropolis', 1927)],
    watched: [t('Das Boot', 1981), t('The Boat', 1981)],
    label: 'no',
    reason: { kind: 'shownAndWrong' },
  },
  {
    id: 'dancer-in-the-dark-in-a-better-world',
    pick: [t('Dancer in the Dark', 2000)],
    watched: [t('In a Better World', 2010), t('Hævnen', 2010)],
    label: 'no',
    reason: { kind: 'shownAndWrong' },
  },
  {
    id: 'dancer-in-the-dark-fargo',
    pick: [t('Dancer in the Dark', 2000)],
    watched: [t('Fargo', 1996)],
    label: 'no',
    reason: { kind: 'shownAndWrong' },
  },
  // ---- First derivation: what the same library offered when it could reach
  //      past the viewer's history — recognised as right.
  {
    id: 'metropolis-woman-in-the-moon',
    pick: [t('Metropolis', 1927)],
    watched: [t('Woman in the Moon', 1929), t('Frau im Mond', 1929)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Fritz Lang' },
  },
  {
    id: 'metropolis-die-nibelungen',
    pick: [t('Metropolis', 1927)],
    watched: [
      t('Die Nibelungen: Siegfried', 1924),
      t('Die Nibelungen', 1924),
      t("Die Nibelungen: Kriemhild's Revenge", 1924),
    ],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Fritz Lang' },
  },
  {
    id: 'dancer-in-the-dark-breaking-the-waves',
    pick: [t('Dancer in the Dark', 2000)],
    watched: [t('Breaking the Waves', 1996)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Lars von Trier' },
  },
  {
    id: 'dancer-in-the-dark-dogville',
    pick: [t('Dancer in the Dark', 2000)],
    watched: [t('Dogville', 2003)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Lars von Trier' },
  },
  {
    id: 'stalker-solaris',
    pick: [t('Stalker', 1979)],
    watched: [t('Solaris', 1972), t('Solyaris', 1972)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Andrei Tarkovsky' },
  },
  {
    id: 'stalker-mirror',
    pick: [t('Stalker', 1979)],
    watched: [t('Mirror', 1975), t('The Mirror', 1975), t('Zerkalo', 1975)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Andrei Tarkovsky' },
  },
  {
    id: 'poor-things-kinds-of-kindness',
    pick: [t('Poor Things', 2023)],
    watched: [t('Kinds of Kindness', 2024)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Yorgos Lanthimos' },
  },
  {
    id: 'dune-part-two-dune',
    pick: [t('Dune: Part Two', 2024)],
    watched: [t('Dune', 2021), t('Dune: Part One', 2021)],
    label: 'yes',
    reason: { kind: 'sameFranchise' },
  },
  // ---- Second derivation: rejected by the old 0.72 bar, "matches nobody
  //      would call weak".
  {
    id: 'furiosa-fury-road',
    pick: [t('Furiosa: A Mad Max Saga', 2024)],
    watched: [t('Mad Max: Fury Road', 2015), t('Mad Max', 1979)],
    label: 'yes',
    reason: { kind: 'sameFranchise' },
  },
  {
    id: 'top-gun-maverick-dead-reckoning',
    pick: [t('Top Gun: Maverick', 2022)],
    watched: [
      t('Mission: Impossible - Dead Reckoning Part One', 2023),
      t('Mission: Impossible - Dead Reckoning', 2023),
    ],
    label: 'arguable',
    reason: { kind: 'arguableStar', name: 'Tom Cruise' },
  },
  {
    id: 'thunderbolts-guardians',
    pick: [t('Thunderbolts*', 2025), t('Thunderbolts', 2025)],
    watched: [t('Guardians of the Galaxy', 2014)],
    label: 'yes',
    reason: { kind: 'sameUniverse' },
  },
  {
    id: 'mulholland-drive-blue-velvet',
    pick: [t('Mulholland Drive', 2001), t('Mulholland Dr.', 2001)],
    watched: [t('Blue Velvet', 1986)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'David Lynch' },
  },
  {
    id: 'blade-runner-2049-dune-part-two',
    pick: [t('Blade Runner 2049', 2017)],
    watched: [t('Dune: Part Two', 2024)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Denis Villeneuve' },
  },
  {
    id: 'nobody-john-wick',
    pick: [t('Nobody', 2021)],
    watched: [t('John Wick', 2014)],
    label: 'yes',
    reason: { kind: 'samePremise' },
  },
  {
    id: 'irishman-gangs-of-new-york',
    pick: [t('The Irishman', 2019)],
    watched: [t('Gangs of New York', 2002)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Martin Scorsese' },
  },
  {
    id: 'martian-prometheus',
    pick: [t('The Martian', 2015)],
    watched: [t('Prometheus', 2012)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Ridley Scott' },
  },
  // ---- Second derivation: admitted by the bar, but looser than the matches
  //      above, or in the band where "both are recent" starts winning.
  {
    id: 'children-of-men-inception',
    pick: [t('Children of Men', 2006)],
    watched: [t('Inception', 2010)],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  {
    id: 'whiplash-flight',
    pick: [t('Whiplash', 2014)],
    watched: [t('Flight', 2012)],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  {
    id: 'batman-dead-reckoning',
    pick: [t('The Batman', 2022)],
    watched: [
      t('Mission: Impossible - Dead Reckoning Part One', 2023),
      t('Mission: Impossible - Dead Reckoning', 2023),
    ],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  {
    id: 'one-battle-after-another-a-working-man',
    pick: [t('One Battle After Another', 2025)],
    watched: [t('A Working Man', 2025)],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  {
    id: 'coco-finding-dory',
    pick: [t('Coco', 2017)],
    watched: [t('Finding Dory', 2016)],
    label: 'arguable',
    reason: { kind: 'arguableStudio', name: 'Pixar' },
  },
  {
    id: 'thirteen-lives-death-on-the-nile',
    pick: [t('Thirteen Lives', 2022)],
    watched: [t('Death on the Nile', 2022)],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  // ---- "What no threshold fixes": strong pairs well under the bar.
  {
    id: 'die-hard-live-free-or-die-hard',
    pick: [t('Die Hard', 1988)],
    watched: [t('Live Free or Die Hard', 2007), t('Die Hard 4.0', 2007)],
    label: 'yes',
    reason: { kind: 'sameFranchise' },
  },
  {
    id: 'decalogue-veronique',
    pick: [
      t('Dekalog: One', 1989),
      t('Decalogue I', 1989),
      t('Dekalog, jeden', 1989),
      t('Decalogue I: I Am the Lord Thy God', 1989),
    ],
    watched: [t('The Double Life of Véronique', 1991), t('La double vie de Véronique', 1991)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Krzysztof Kieślowski' },
  },
  {
    id: 'paris-texas-perfect-days',
    pick: [t('Paris, Texas', 1984)],
    watched: [t('Perfect Days', 2023)],
    label: 'yes',
    reason: { kind: 'sameDirector', name: 'Wim Wenders' },
  },
  {
    id: 'marriage-story-poor-things',
    pick: [t('Marriage Story', 2019)],
    watched: [t('Poor Things', 2023)],
    label: 'no',
    reason: { kind: 'looseOnly' },
  },
  // ---- The operator's rule: an actor alone is not a reason.
  {
    id: 'spider-man-no-way-home-uncharted',
    pick: [t('Spider-Man: No Way Home', 2021)],
    watched: [t('Uncharted', 2022)],
    label: 'no',
    reason: { kind: 'actorOnly', name: 'Tom Holland' },
  },
]

/** How many times each pair is asked. Two, because one call cannot tell a difference from noise. */
export const BENCHMARK_RUNS_PER_PAIR = 2

export type BenchmarkPairStatus = 'scored' | 'notInLibrary' | 'failed' | 'notRun'

/** Where a benchmark pair came from: this file, or the operator's live labels. */
export type BenchmarkSource = 'reference' | 'yours'

export interface BenchmarkPairResult {
  id: string
  source: BenchmarkSource
  mediaType: 'movie' | 'series'
  label: BenchmarkLabel
  reason: { kind: BenchmarkReasonKind; name?: string }
  /** The titles as the library holds them, or as requested when not found. */
  pickTitle: string
  watchedTitle: string
  status: BenchmarkPairStatus
  /** Which side(s) the library lacks, when status is notInLibrary. */
  missing: Array<'pick' | 'watched'>
  /** Raw cosine on the active embedding set, as storeEvidence computes it. */
  similarity: number | null
  /** The cosine bar's call, or null when either title has no embedding. */
  thresholdSays: boolean | null
  /** One P(yes) per run that answered. */
  modelRuns: number[]
  /** The model's call on the mean of its runs, or null when none answered. */
  modelSays: boolean | null
  /** The runs landed on different sides of the line. */
  unstable: boolean
  /** The credits rule's call (see creditsRuleVerdict), or null when not computed. */
  ruleSays: boolean | null
  /** What the rule matched on, when it said yes. */
  ruleBasis: 'director' | 'franchise' | null
  error?: string
}

/** Right answers for each side on one set of pairs. */
export interface BenchmarkTally {
  scored: number
  thresholdRight: number
  ruleRight: number
  modelRight: number
}

export interface BenchmarkScore extends BenchmarkTally {
  /** Scored pairs the threshold got wrong and the model got right, and the reverse. */
  modelFixed: number
  modelBroke: number
  /** Scored pairs the credits rule got wrong and the model got right, and the reverse. */
  modelBeatRule: number
  ruleBeatModel: number
  /**
   * The same tally restricted to pairs sharing neither a director nor a
   * franchise — the only pairs where the model has to read the films rather
   * than two fields, and so the only ones that say whether it is worth more
   * than the free rule.
   */
  noSharedCredits: BenchmarkTally
  /** The same tally per source, so the reference set and your labels read apart. */
  bySource: Record<BenchmarkSource, BenchmarkTally>
  unstable: number
  arguable: number
  notInLibrary: number
  failed: number
  notRun: number
}

/** The credits the rule reads. A subset of JudgedTitleFacts, so a run's facts fit. */
export interface CreditFacts {
  creators: string[]
  franchise?: string | null
}

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/**
 * The free baseline: a reason when the two films share a director (a creator,
 * for series) or a TMDb franchise, and not otherwise.
 *
 * It reads exactly the two fields the model is shown, which is the point: on a
 * pair it can sort, the model is being paid to read a field. Names are
 * compared accent- and case-insensitively, because the two titles may have
 * been enriched by different sources. A film with no director recorded simply
 * cannot match on one — the rule says no, as it would in use, which is why the
 * card reports the rule's basis rather than only its answer.
 */
export function creditsRuleVerdict(
  pick: CreditFacts,
  watched: CreditFacts
): { says: boolean; basis: 'director' | 'franchise' | null } {
  const pickCreators = new Set(pick.creators.filter(Boolean).map(normalizeName))
  if (watched.creators.some((name) => name && pickCreators.has(normalizeName(name)))) {
    return { says: true, basis: 'director' }
  }
  const a = pick.franchise?.trim()
  const b = watched.franchise?.trim()
  if (a && b && normalizeName(a) === normalizeName(b)) return { says: true, basis: 'franchise' }
  return { says: false, basis: null }
}

/** The model's call on its runs: the mean of what answered, against its own boundary. */
export function modelVerdict(runs: readonly number[]): { says: boolean | null; unstable: boolean } {
  if (runs.length === 0) return { says: null, unstable: false }
  const mean = runs.reduce((a, b) => a + b, 0) / runs.length
  const sides = new Set(runs.map((p) => p >= EVIDENCE_JUDGMENT_MIN_YES))
  return { says: mean >= EVIDENCE_JUDGMENT_MIN_YES, unstable: sides.size > 1 }
}

/** The cosine bar's call on one pair, exactly as the panel would make it. */
export function thresholdVerdict(similarity: number | null): boolean | null {
  return similarity == null ? null : hasCausalEvidence([similarity])
}

const emptyTally = (): BenchmarkTally => ({
  scored: 0,
  thresholdRight: 0,
  ruleRight: 0,
  modelRight: 0,
})

/**
 * The scoreboard. A pair counts only when it is labelled yes/no AND all three
 * sides — threshold, credits rule, model — gave an answer, so they are always
 * scored on the same set: a model that failed half its calls cannot look
 * better or worse by being measured on fewer pairs.
 */
export function scoreBenchmark(results: readonly BenchmarkPairResult[]): BenchmarkScore {
  const score: BenchmarkScore = {
    ...emptyTally(),
    modelFixed: 0,
    modelBroke: 0,
    modelBeatRule: 0,
    ruleBeatModel: 0,
    noSharedCredits: emptyTally(),
    bySource: { reference: emptyTally(), yours: emptyTally() },
    unstable: 0,
    arguable: 0,
    notInLibrary: 0,
    failed: 0,
    notRun: 0,
  }
  for (const r of results) {
    if (r.status === 'notInLibrary') score.notInLibrary++
    else if (r.status === 'failed') score.failed++
    else if (r.status === 'notRun') score.notRun++
    if (r.unstable) score.unstable++
    if (r.label === 'arguable') {
      score.arguable++
      continue
    }
    if (r.status !== 'scored' || r.thresholdSays == null || r.modelSays == null || r.ruleSays == null) {
      continue
    }
    const truth = r.label === 'yes'
    const thresholdRight = r.thresholdSays === truth
    const ruleRight = r.ruleSays === truth
    const modelRight = r.modelSays === truth

    const tallies: BenchmarkTally[] = [score, score.bySource[r.source ?? 'reference']]
    if (r.ruleBasis == null) tallies.push(score.noSharedCredits)
    for (const tally of tallies) {
      tally.scored++
      if (thresholdRight) tally.thresholdRight++
      if (ruleRight) tally.ruleRight++
      if (modelRight) tally.modelRight++
    }
    if (modelRight && !thresholdRight) score.modelFixed++
    if (!modelRight && thresholdRight) score.modelBroke++
    if (modelRight && !ruleRight) score.modelBeatRule++
    if (!modelRight && ruleRight) score.ruleBeatModel++
  }
  return score
}
