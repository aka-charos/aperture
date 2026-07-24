/**
 * Web search source abstraction for the assistant's discovery pipeline.
 *
 * A source turns a free-text request into grounded web material (text, plus
 * optional structured references). Two kinds exist today: the Google grounding
 * role (an LLM that searches and suggests) and Tavily (a pure search API). The
 * orchestrator runs every enabled source, combines their text, and feeds the
 * combination into ONE structuring pass — so sources compose (extra grounding),
 * fall back for one another, and let the model synthesize across all of them.
 *
 * Every source MUST fail open: `gather` returns null on any error, or when the
 * source is disabled/unconfigured, and never throws into the orchestrator.
 *
 * Adding a source (e.g. a self-hosted SearxNG) = implement this interface and
 * register it in ./index.ts — nothing else in the pipeline changes.
 */

export interface WebSearchSourceReference {
  title: string
  url: string
  content: string
}

export interface WebSearchSourceResult {
  /** Stable source id ('google' | 'tavily' | …) for logging + labeling. */
  source: string
  /** Grounded material: LLM suggestions (Google) or answer + snippets (Tavily). */
  text: string
  /** Optional structured references (citations); unused by structuring today. */
  references?: WebSearchSourceReference[]
}

export interface WebSearchSource {
  /** Stable id, also used as the label in the combined material and logs. */
  readonly id: string
  /**
   * Produce grounded material for the query, or null when this source is
   * disabled, unconfigured, errored, or returned nothing usable. Must not throw.
   */
  gather(query: string): Promise<WebSearchSourceResult | null>
}
