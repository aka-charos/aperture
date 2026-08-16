/**
 * Grounded per-title analysis: how a film or show was made, what its makers
 * were attempting, where it sits, what critics argue about.
 *
 * Title-scoped, never user-scoped — nothing in it depends on who is reading, so
 * it is generated once, cached forever, and shared by every user. That is what
 * separates it from a recommendation explanation, which is about (user x title)
 * and is rewritten whenever the recommender runs. The two prompts pull in
 * opposite directions (one is fenced against outside knowledge, this one is
 * made of it) and must never be merged.
 */
export {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  type AnalysisSubject,
  type ReceptionContext,
  type SourceGrade,
  type ParsedAnalysis,
} from './prompt.js'

export {
  decideAnalysisFloor,
  MIN_ANALYSIS_CHARS,
  MIN_GROUNDING_CHUNKS,
  type DeclineReason,
  type FloorDecision,
  type FloorInput,
} from './sourceFloor.js'

export {
  analysisJoinSql,
  analysisPriorityOrderSql,
  needsAnalysisSql,
  pendingAnalysisFromSql,
  type AnalysisSqlAliases,
} from './pending.js'

export { analyseTitle, getStoredAnalysis, type StoredAnalysis } from './generate.js'

export {
  countPendingAnalysis,
  loadAnalysisSubject,
  selectPendingTitles,
  type PendingTitle,
} from './titles.js'

export {
  generateTitleAnalyses,
  getAnalysisStatus,
  DEFAULT_DAILY_BUDGET,
  type AnalysisJobOptions,
  type AnalysisJobResult,
} from './job.js'
