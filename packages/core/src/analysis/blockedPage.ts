/**
 * Whether a scraped page is a bot check or an access wall rather than the page.
 *
 * WHY THIS EXISTS. Two bench runs in a row (Session 9, Terminator 2) carried a
 * Cloudflare "Performing security verification" screen as a source, and the
 * Terminator 2 run carried four of them out of eight: two Cloudflare challenges
 * and two ResearchGate "Access restricted" pages - including the one scholarly
 * source the search had found. The budget step does not catch them, because it
 * only drops a document whose allocated SLICE would be too small, and a
 * 330-character wall is short enough to be kept whole. So they reached the
 * prompt as numbered documents, and the report counted them as retrieval.
 *
 * SHORT AND MATCHING, BOTH. A wall is a few hundred characters of boilerplate;
 * an article that happens to discuss Cloudflare, CAPTCHAs or restricted access
 * is long. Requiring both keeps a real page from ever being dropped for its
 * subject, which is the failure that would cost a source silently.
 *
 * Every pattern is a phrase measured on a real retrieved wall, not a guess at
 * what one might say. A new wall gets a pattern when it has been seen.
 *
 * PURE AND DB-FREE, like ./budget.ts which it runs in front of.
 */

/** Above this a page is treated as content whatever it says. */
export const BLOCKED_PAGE_MAX_CHARS = 2000

const BLOCKED_PAGE_PATTERNS: readonly RegExp[] = [
  // Cloudflare's managed challenge, as scraped to markdown.
  /performing security verification/i,
  /verification successful\.?\s*waiting for/i,
  /this website uses a security service to protect against malicious bots/i,
  /^#*\s*just a moment\.{3}/im,
  /checking (?:if the site connection is secure|your browser before accessing)/i,
  /enable javascript and cookies to continue/i,
  /attention required!?\s*\|\s*cloudflare/i,
  // ResearchGate and similar network-level refusals.
  /we've detected unusual activity from your network/i,
  /access to this page (?:is|has been) temporarily restricted/i,
]

export function isBlockedPage(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim()
  if (!trimmed || trimmed.length > BLOCKED_PAGE_MAX_CHARS) return false
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(trimmed))
}
