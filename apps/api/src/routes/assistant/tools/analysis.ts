/**
 * Read a title's stored analysis into the chat.
 *
 * RETRIEVAL ONLY — it never calls `analyseTitle`. That is not a simplification,
 * it is the whole shape of the tool. Generating is a retrieval pass plus a long
 * writing call, minutes of work behind a pacing gate, against a five-step turn
 * budget where each step resends every accumulated tool result; and it WRITES,
 * to a row that is title-scoped, shared by every user, and retired until
 * `ANALYSIS_PROMPT_VERSION` moves. A casual chat question must not be able to
 * commit that on everyone's behalf — which is the same reason `?force=true` on
 * the analysis route is admin-only. The library job populates the table; this
 * reads it.
 *
 * So a miss is a real answer, not a failure, and the four statuses are the
 * point: `notAnalyzed` (nobody has run it) and `declined` (it WAS run and the
 * sources were not there) mean opposite things to a model deciding whether to
 * fall back on what it knows. Collapsing them into "no analysis" invites it to
 * confidently reconstruct an article that was deliberately not written.
 *
 * Everything shown is a stored, source-grounded account of the work — never
 * user-scoped. It is not a recommendation explanation and the two must not be
 * blended; see the analysis barrel.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { nullSafe } from './utils.js'
import {
  buildAnalysisSegments,
  getStoredAnalysis,
  type AnalysisQuestionId,
} from '@aperture/core'
import { queryOne } from '../../../lib/db.js'
import { anyTitleMatchesSql, titleMatchRankSql } from '../helpers/titleMatch.js'
import type { ToolContext } from '../types.js'

/**
 * The question whose paragraph can give the ending away.
 *
 * A work whose revelation is its antecedent has that revelation carried across
 * by naming the antecedent — measured on Incendies, where a model that followed
 * every other rule named *Oedipus Rex* and gave the film away. The prompt asks
 * it not to; that is an instruction, and instructions eventually fail.
 *
 * The detail panel gated this behind a disclosure and the operator removed it,
 * on the sound argument that a control costs every reader a click on every
 * title to protect a minority. Chat is a different bargain: nobody opened an
 * article here, and the model is going to PARAPHRASE this into prose whether or
 * not a reader would have clicked. So the flag ships as a decided boolean and
 * the tool rules tell the model when not to relay it.
 */
const SPOILER_RISK_QUESTIONS: ReadonlySet<AnalysisQuestionId> = new Set(['tradition'])

/** One labelled run of the analysis, as the card renders it. */
export interface AnalysisToolSegment {
  text: string
  /**
   * Question ids, not finished labels: the vocabulary is small and closed, and
   * the client has 15 locales to render it into. It already owns these strings
   * under `mediaDetail.analysis.section.*` for the detail panel.
   */
  questions: AnalysisQuestionId[]
  /**
   * Decided here, never in the bundle: which question ids are spoiler-shaped is
   * a fact about the prompt, and the web bundle must not carry a copy of it
   * that can drift the first time the question set changes.
   */
  spoilerRisk: boolean
}

export interface AnalysisToolResult {
  id: string
  analysis: {
    /** What the model asked for, echoed so a miss can name it. */
    query: string
    status: 'available' | 'declined' | 'notAnalyzed' | 'notInLibrary'
    contentId: string | null
    type: 'movie' | 'series' | null
    title: string | null
    year: number | null
    poster: string | null
    segments: AnalysisToolSegment[]
    /** Why the writer declined — set only when status is 'declined'. */
    declineReason: string | null
    sourceCount: number | null
    sourceGrade: string | null
    analyzedAt: string | null
  }
}

interface TitleRow {
  id: string
  title: string
  year: number | null
  poster_url: string | null
}

const SELECT_COLUMNS = 'id, title, year, poster_url'

async function resolveTitle(
  title: string,
  type: 'movie' | 'series' | 'any'
): Promise<{ row: TitleRow; mediaType: 'movie' | 'series' } | null> {
  // Movie first when unconstrained, matching getContentDetails. `type` exists
  // so the model can break the tie the ordering cannot — Fargo is a film and a
  // series, and table order would otherwise always answer "film".
  const tables: Array<['movie' | 'series', string]> =
    type === 'series'
      ? [['series', 'series']]
      : type === 'movie'
        ? [['movie', 'movies']]
        : [
            ['movie', 'movies'],
            ['series', 'series'],
          ]

  for (const [mediaType, table] of tables) {
    // The one title-matching path in the repo: unaccent()ed across all three
    // name columns, ranked localized > original > sort, because the name on the
    // poster is the one the user typed.
    const row = await queryOne<TitleRow>(
      `SELECT ${SELECT_COLUMNS} FROM ${table}
        WHERE ${anyTitleMatchesSql('$1')}
        ORDER BY ${titleMatchRankSql('$2')} LIMIT 1`,
      [`%${title}%`, title]
    )
    if (row) return { row, mediaType }
  }
  return null
}

export function createAnalysisTools(_ctx: ToolContext) {
  return {
    getTitleAnalysis: tool({
      description:
        "Read the stored critical analysis of one title in the user's library: what the work " +
        'is doing and how its choices serve that, what tradition it sits in, what its makers ' +
        'said they were attempting, the circumstances it was made under, and what critics ' +
        'still argue about. Written from retrieved published sources and cached, so it is ' +
        'about the WORK and is the same for every user — it is not a recommendation and says ' +
        'nothing about why this person might like it. Use it for "tell me about X", "what is ' +
        'X doing", "why does X matter", "what do critics say about X". Returns one title per ' +
        'call. It only reads what has already been written: a status of notAnalyzed means ' +
        'nobody has run it yet, and declined means it WAS run and there was not enough ' +
        'published material — those are different facts and must not be reported the same way.',
      inputSchema: nullSafe(
        z.object({
          title: z.string().describe('The title to look up, as the user named it'),
          type: z
            .enum(['movie', 'series', 'any'])
            .optional()
            .default('any')
            .describe(
              'Narrow the lookup when a name belongs to both a film and a series (e.g. Fargo)'
            ),
        })
      ),
      execute: async ({ title, type = 'any' }): Promise<AnalysisToolResult> => {
        const empty = {
          contentId: null,
          type: null,
          title: null,
          year: null,
          poster: null,
          segments: [],
          declineReason: null,
          sourceCount: null,
          sourceGrade: null,
          analyzedAt: null,
        }

        const resolved = await resolveTitle(title, type)
        if (!resolved) {
          // Not an error: the library simply does not hold it. The model can
          // still answer from what it knows, and saying so is more useful than
          // a red box.
          return {
            id: `analysis-missing-${Date.now()}`,
            analysis: { ...empty, query: title, status: 'notInLibrary' },
          }
        }

        const { row, mediaType } = resolved
        const stored = await getStoredAnalysis(mediaType, row.id)

        const identity = {
          contentId: row.id,
          type: mediaType,
          title: row.title,
          year: row.year,
          poster: row.poster_url,
        }

        if (!stored || (!stored.analysis && !stored.declineReason)) {
          return {
            id: `analysis-pending-${Date.now()}`,
            analysis: {
              ...empty,
              ...identity,
              query: title,
              status: 'notAnalyzed',
            },
          }
        }

        if (!stored.analysis) {
          return {
            id: `analysis-declined-${Date.now()}`,
            analysis: {
              ...empty,
              ...identity,
              query: title,
              status: 'declined',
              declineReason: stored.declineReason,
              analyzedAt: stored.analyzedAt,
            },
          }
        }

        // Tolerant by design: a row written before prompt version 6, or one
        // whose map failed validation, comes back as a single unlabelled
        // segment holding the analysis exactly as stored.
        const segments = buildAnalysisSegments(stored.analysis, stored.paragraphMap).map(
          (segment) => ({
            text: segment.text,
            questions: segment.questions,
            spoilerRisk: segment.questions.some((q) => SPOILER_RISK_QUESTIONS.has(q)),
          })
        )

        return {
          id: `analysis-${Date.now()}`,
          analysis: {
            ...identity,
            query: title,
            status: 'available',
            segments,
            declineReason: null,
            sourceCount: stored.sourceCount,
            sourceGrade: stored.sourceGrade,
            analyzedAt: stored.analyzedAt,
          },
        }
      },
    }),
  }
}
