/**
 * Interim phase status for the chat UI.
 *
 * A turn can sit behind five LLM calls and ~25 DB queries (intent routing,
 * prompt building, then the whole discovery pipeline inside one tool call). The
 * UI used to show a single static "Thinking…" for all of it. These events let it
 * say what is actually happening now.
 *
 * Emitted as transient `data-status` parts on the UI message stream: transient
 * parts reach the client's `onData` but never enter message state, so there is
 * nothing to persist and nothing for the message saver — which only understands
 * text and tool-call parts — to drop on the floor.
 *
 * `phase` is an i18n KEY FRAGMENT, never English text. The client resolves
 * `assistant.status.<phase>`, so a phase name that reaches the UI without a
 * translation degrades to "Thinking…" rather than rendering a raw key.
 *
 * DELIBERATE AMBIGUITY: `discoveryScouting` and `broadening` cover work that
 * reaches the open web. Their user-facing wording must never say so — see the
 * phrase table in `apps/web/src/i18n/locales/en/translation.json`.
 */
import type { ToolSet, UIMessageStreamWriter } from 'ai'

/**
 * Every phase the server can report. The single source of truth for the
 * vocabulary — a typo in a `TOOL_PHASES` value or an `onStatus` call is a
 * compile error rather than a silent "Thinking…" in the UI.
 *
 * (`stillWorking` is deliberately absent: it is a client-side stall fallback,
 * not something the server ever emits.)
 */
export type StatusPhase =
  // Lifecycle
  | 'preparing'
  | 'understanding'
  | 'composing'
  // Per-tool
  | 'searchingLibrary'
  | 'episodes'
  | 'findingSimilar'
  | 'personalPicks'
  | 'ranking'
  | 'unwatched'
  | 'history'
  | 'ratings'
  | 'details'
  | 'people'
  | 'studios'
  | 'stats'
  | 'genres'
  | 'franchises'
  | 'help'
  | 'broadening'
  | 'working'
  // Discovery sub-phases (one tool call, nine stages)
  | 'discoveryScouting'
  | 'discoveryShortlist'
  | 'discoveryMatching'
  | 'discoveryRelated'
  | 'discoveryReasons'
  | 'discoveryAssembling'

export type StatusEmitter = (phase: StatusPhase) => void

/**
 * Bind an emitter to a stream writer. Writes are wrapped: a status update is
 * cosmetic, and must never be able to abort a turn that is otherwise fine.
 */
export function createStatusEmitter(writer: UIMessageStreamWriter): StatusEmitter {
  return (phase) => {
    try {
      writer.write({ type: 'data-status', data: { phase }, transient: true })
    } catch {
      // Stream already closed (client navigated away mid-turn), or enqueue
      // refused. Nothing to do — the answer itself is unaffected.
    }
  }
}

/**
 * Tool name → phase. Grouped so tools that look the same to a user share a
 * phrase; the point is telling them what kind of work is happening, not naming
 * internals. A tool missing from this table reports the generic 'working'.
 */
const TOOL_PHASES: Record<string, StatusPhase> = {
  searchContent: 'searchingLibrary',
  semanticSearch: 'searchingLibrary',
  searchByKeyword: 'searchingLibrary',
  searchEpisodes: 'episodes',
  findSimilarContent: 'findingSimilar',
  getMyRecommendations: 'personalPicks',
  searchMyRecommendations: 'personalPicks',
  getTopRated: 'ranking',
  getTopByRtScore: 'ranking',
  getAwardWinners: 'ranking',
  getContentRankings: 'ranking',
  getUnwatched: 'unwatched',
  getWatchHistory: 'history',
  getUserRatings: 'ratings',
  getContentDetails: 'details',
  searchPeople: 'people',
  getTopStudios: 'studios',
  getLibraryStats: 'stats',
  getAvailableGenres: 'genres',
  getFranchises: 'franchises',
  getFranchiseProgress: 'franchises',
  getSystemHelp: 'help',
  search_web: 'broadening',
  // The discovery tool reports its own sub-phases from inside execute; this is
  // just the first line, shown before it gets going.
  findCandidatesInLibrary: 'discoveryScouting',
}

/**
 * Wrap every tool so entering it reports a phase — per-tool status for the whole
 * toolset without touching a single tool file. Same shape as
 * `withUnwatchedFilter` / `withToolErrorHandling`.
 *
 * Concurrent tool calls in one step each emit on entry and the last write wins.
 * A stack would be more faithful and less legible; one line that keeps changing
 * is the point.
 */
export function withStatusEvents<T extends ToolSet>(tools: T, emit: StatusEmitter): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      const execute = toolDef.execute
      if (!execute) return [name, toolDef]
      const phase = TOOL_PHASES[name] ?? 'working'
      const reporting: typeof execute = (input, options) => {
        emit(phase)
        return execute(input, options)
      }
      return [name, { ...toolDef, execute: reporting }]
    })
  ) as T
}
