/**
 * Per-title analysis: how a film or show was made, what its makers were
 * attempting, where it sits, what critics argue about.
 *
 * Title-scoped, never user-scoped — nothing in it depends on who is reading, so
 * it is generated once, cached forever, and shared by every user. That is what
 * separates it from a recommendation explanation, which is about (user x title)
 * and is rewritten whenever the recommender runs. The two must never be merged,
 * but they are fenced alike: both may use only the material handed to them, one
 * because it writes from pipeline output and this one because its sources are
 * retrieved and pasted into the prompt.
 *
 * Retrieval is a self-hosted fastCRW service (`lib/crw.ts`), and the writing
 * model is whatever the `titleAnalysis` role points at — typically a local one.
 * Neither half spends a metered quota, which is what makes walking a whole
 * library possible at all.
 */
export {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  buildAnalysisQuery,
  parseAnalysisResponse,
  type AnalysisSource,
  type AnalysisSubject,
  type ReceptionContext,
  type SourceGrade,
  type ParsedAnalysis,
} from './prompt.js'

export {
  decideAnalysisFloor,
  isListingDomain,
  MIN_ANALYSIS_CHARS,
  MIN_GROUNDING_CHUNKS,
  MIN_SUBSTANTIVE_SOURCES,
  MIN_SUBSTANTIVE_SOURCE_CHARS,
  type DeclineReason,
  type FloorDecision,
  type FloorInput,
  type RetrievalEvidence,
  type RetrievedSource,
} from './sourceFloor.js'

export {
  getRetrievalMode,
  setRetrievalMode,
  isRetrievalMode,
  checkModeReadiness,
  DEFAULT_RETRIEVAL_MODE,
  type RetrievalMode,
  type ModeReadiness,
} from './mode.js'

export { budgetSources, type BudgetOptions } from './budget.js'

export {
  analysisJoinSql,
  analysisPriorityOrderSql,
  isAnalysisStale,
  needsAnalysisSql,
  pendingAnalysisFromSql,
  type AnalysisSqlAliases,
} from './pending.js'

export {
  analyseTitle,
  getStoredAnalysis,
  AnalysisCancelledError,
  type StoredAnalysis,
  type AnalyseTitleOptions,
} from './generate.js'

export {
  countPendingAnalysis,
  loadAnalysisSubject,
  selectPendingTitles,
  type PendingTitle,
} from './titles.js'

export {
  generateTitleAnalyses,
  getAnalysisStatus,
  DEFAULT_MAX_TITLES_PER_RUN,
  type AnalysisJobOptions,
  type AnalysisJobResult,
} from './job.js'
