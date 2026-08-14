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
   *
   * The QUERY IS THE ONLY INPUT, and deliberately so. A source used to be able
   * to take a `WebSearchContext` carrying the viewer's taste profile; Google
   * grounding did, and turned it into search terms — a request for French film
   * noir "based on my history" became twelve queries about the user's favourite
   * surrealist film, despite an explicit instruction not to search for it.
   * Personalisation now happens after retrieval, in the structuring pass, where
   * it can only reorder what the search found. Do not reintroduce a channel
   * here: retrieval must answer the question the user asked and nothing else.
   */
  gather(query: string): Promise<WebSearchSourceResult | null>
}
