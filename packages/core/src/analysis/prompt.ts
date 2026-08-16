/**
 * The grounded title-analysis prompt.
 *
 * Prototyped by hand against Gemini before any of this was written, which is
 * where every rule below comes from. Two findings shaped it:
 *
 * 1. QUESTIONS, NOT A DIRECTIVE. "Analyse this film" produces padding for a
 *    film with nothing to say, because a model asked for critical analysis
 *    always complies — it will find meditations on grief in an action
 *    programmer. Specific questions with no answers produce short output
 *    instead. Measured: Love Actually returned ~250 words and Dancer in the
 *    Dark ~900, from the same prompt, both correct.
 *
 * 2. MEET THE FILM AT ITS OWN LEVEL. The failure to avoid is not "analysing a
 *    genre entertainment", it is analysing one *as if it were art cinema*. A
 *    stunt-driven action film has a real subject — staging, choreography, how
 *    its action stays legible — and writing about that honestly is useful.
 *    Writing about it in Tarkovsky vocabulary is not.
 *
 * Spoilers are handled STRUCTURALLY rather than by instruction: all four
 * questions are about craft, intent, tradition and critical reception, which
 * are pre-viewing questions by construction. This repo already decided that
 * "don't spoil" as a rule is one that only has to fail once — it is why
 * `plot_full` is kept out of the explanation prompt and behind a button in the
 * UI. The answer here is to not ask about the plot at all.
 */

/**
 * Bump when the prompt changes in a way that should invalidate stored analysis.
 * Every row below this becomes pending again — see 0143. That makes a prompt
 * change a config change rather than a migration, which is what 0137 and 0139
 * were both written to work around.
 */
export const ANALYSIS_PROMPT_VERSION = 1

/** Reception figures, passed as calibration only. All optional. */
export interface ReceptionContext {
  metacriticScore?: number | null
  rtCriticScore?: number | null
  imdbRating?: number | null
  imdbVoteCount?: number | null
  awardsSummary?: string | null
}

export interface AnalysisSubject {
  title: string
  year: number | null
  mediaType: 'movie' | 'series'
  directors?: string[] | null
  reception: ReceptionContext
}

/**
 * Reception as a single line the model can calibrate against.
 *
 * This is what stops a Criterion essay being written about a Metacritic 46: the
 * model does not have to guess how seriously the film was taken, so the
 * register follows the evidence rather than the request. It is explicitly NOT
 * content — the scores are already on the detail page, and an analysis that
 * recites them has spent its space on something the reader can see.
 */
function receptionLine(r: ReceptionContext): string | null {
  const parts: string[] = []
  if (r.metacriticScore != null) parts.push(`Metacritic ${r.metacriticScore}`)
  if (r.rtCriticScore != null) parts.push(`Rotten Tomatoes ${r.rtCriticScore}`)
  if (r.imdbRating != null) {
    parts.push(
      r.imdbVoteCount != null
        ? `IMDb ${r.imdbRating} from ${r.imdbVoteCount.toLocaleString('en-US')} votes`
        : `IMDb ${r.imdbRating}`
    )
  }
  if (r.awardsSummary) parts.push(`Awards: ${r.awardsSummary}`)
  return parts.length > 0 ? parts.join(' | ') : null
}

const MOVIE_QUESTIONS = [
  'What is formally or technically distinctive about how it was made?',
  'What did the people who made it say they were trying to do?',
  'What tradition does it sit in - what was it responding to, what did it influence?',
  'What do critics genuinely disagree about?',
]

/**
 * Series get a fourth-question variant and one extra: a show's identity is
 * often in how it is structured across a run (serialised vs episodic, how it
 * changed between seasons), which has no film equivalent and is exactly the
 * kind of thing a viewer choosing what to start wants to know.
 */
const SERIES_QUESTIONS = [
  'What is formally or technically distinctive about how it was made?',
  'What did the people who made it say they were trying to do?',
  'How is it structured across its run - serialised or episodic, and did it change?',
  'What tradition does it sit in - what was it responding to, what did it influence?',
  'What do critics genuinely disagree about?',
]

const RULES = [
  'Describe how it works, never what happens in it. No third-act or ending discussion. Someone who has not seen it must be able to read this safely.',
  'Match your register to the work. A stunt-driven action picture’s craft is its staging and choreography, and that is a legitimate subject - write about it as what it is. Do not apply art-cinema vocabulary to a genre entertainment.',
  'If a question has no real answer here, skip it. If none of them do, say so in two sentences and stop. A short honest answer is correct. Padding is not.',
  'Ground every claim in a source. Prefer critics, filmmaker interviews and film scholarship over aggregators, listicles and marketing copy.',
  'Invent nothing: no production history, festival history or reception that you cannot source.',
  'Length follows the work. Some support 900 words. Many support 200.',
]

/**
 * The closing line is the thin-sourcing signal. It is asked for in the model's
 * own words rather than inferred from the grounding chunk count alone, because
 * a widely-covered blockbuster returns plenty of chunks while carrying no
 * analytical writing at all — count measures obscurity, this measures depth.
 * Both feed the decision in ./sourceFloor.ts.
 */
const SOURCE_GRADE_LINE =
  'End with a single final line, exactly in this form and nothing after it:\n' +
  'SOURCES: substantial | reviews-only | almost-nothing'

export function buildAnalysisPrompt(subject: AnalysisSubject): string {
  const questions = subject.mediaType === 'series' ? SERIES_QUESTIONS : MOVIE_QUESTIONS
  const kind = subject.mediaType === 'series' ? 'series' : 'film'

  const header = [
    `${kind === 'series' ? 'Series' : 'Film'}: ${subject.title}${subject.year ? ` (${subject.year})` : ''}`,
    subject.directors?.length ? `Directed by: ${subject.directors.slice(0, 3).join(', ')}` : null,
    receptionLine(subject.reception)
      ? `Reception, for calibration only - do not quote these numbers back: ${receptionLine(subject.reception)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    header,
    '',
    `Using current web sources, write an analysis of this ${kind}. Not a review, not a plot summary.`,
    '',
    `Answer only the questions that have real answers for this ${kind}:`,
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'RULES',
    ...RULES.map((r) => `- ${r}`),
    '',
    SOURCE_GRADE_LINE,
  ].join('\n')
}

/** The grades the closing line may carry, in descending order of usefulness. */
export type SourceGrade = 'substantial' | 'reviews-only' | 'almost-nothing'

export interface ParsedAnalysis {
  /** Prose with the SOURCES line removed. Empty when the model wrote none. */
  text: string
  /** null when the model omitted the line or wrote something unrecognised. */
  grade: SourceGrade | null
}

const GRADES: SourceGrade[] = ['substantial', 'reviews-only', 'almost-nothing']

/**
 * Split the closing SOURCES line off the prose.
 *
 * Tolerant on purpose: the line is a signal, not a contract, and a model that
 * formats it slightly differently should cost us the signal, not the analysis.
 * An unrecognised or missing grade reads as null, which ./sourceFloor.ts treats
 * as "no opinion" and falls back to the grounding count for.
 */
export function parseAnalysisResponse(raw: string): ParsedAnalysis {
  const lines = raw.trimEnd().split('\n')

  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    const match = /^\s*(?:\*\*)?SOURCES(?:\*\*)?\s*:\s*(.+?)\s*(?:\*\*)?\s*$/i.exec(lines[i])
    if (!match) continue

    const value = match[1].toLowerCase().replace(/[\s_]+/g, '-').replace(/[.*`]/g, '')
    const grade = GRADES.find((g) => value.includes(g)) ?? null
    const text = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim()
    return { text, grade }
  }

  return { text: raw.trim(), grade: null }
}
