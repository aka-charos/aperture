/**
 * Cutting the furniture out of a page we are keeping.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ./sourceQuality.ts. That module decides
 * whether a PAGE is worth anything. This one takes a page that is worth
 * something and removes the parts of it that are not. They are different
 * judgements and neither can do the other's job: the second Requiem for a Dream
 * bench retrieved eleven documents, and the four best of them carried a
 * navigation menu, a cast list of image URLs, a streaming-service ad and an
 * embedded video player's settings panel between the paragraphs that answered
 * the questions.
 *
 * WHAT MAKES IT EXPENSIVE IS THE ORDER OF TWO TRUNCATIONS, both head-first.
 * `crwSearch` clips each page at `maxContentChars` (12,000 by default), and
 * `budgetSources` then water-fills `sourceBudgetChars` across what survives and
 * clips again - so every document on that bench arrived at ~6,390 characters,
 * being its own FIRST 6,390. A page puts its menu first. IMDb's title page
 * spent the whole of its slice on two navigation menus and delivered a genre
 * tag list; Wikipedia - the one document carrying the making and reception
 * facts - spent its slice on the lead and the Plot section and was cut off
 * before Production. The budget also allocates by raw length, so a page that is
 * nine parts menu is handed the same share as an article and spends it on the
 * menu. Bloat is rewarded until something strips it.
 *
 * SO THIS RUNS BEFORE THE BUDGET, NOT AFTER. Stripping afterwards would tidy
 * text the slice had already been spent on.
 *
 * TWO MECHANISMS, BOTH CONSERVATIVE.
 *
 * A RUN of links with no prose in it is a menu; ONE is a caption or a "read
 * more". The predicate is ./sourceQuality.ts's own `isLinkOnlyLine`, already
 * pinned there, so the two modules cannot disagree about what a link line is.
 * The run is measured in LINKS, not lines, because IMDb's navigation bar is one
 * line carrying a dozen of them and a line count sees that as a run of one -
 * which would leave the single largest waste in the retrieval untouched.
 *
 * A PLOT SECTION is content the prompt forbids the model to use, and every
 * version since 7 has spent rules forbidding it. Carrying 4,000 characters of
 * it is paying for the temptation. Only unambiguous headings match - "Plot",
 * "Synopsis", "Storyline" and their two-word forms, nothing else - because
 * "Story" and "Summary" are ordinary words in an essay's own headings, and
 * missing a section costs a share of the budget while removing the wrong one
 * costs the analysis.
 *
 * IT NEVER EMPTIES A DOCUMENT. Removing parts is this module's job; deciding
 * that a whole page is worthless is ./sourceQuality.ts's, and a page that is
 * nothing but a plot summary is a judgement that belongs there with evidence
 * behind it rather than here as a side effect. When a strip would leave nothing
 * at all, the original is returned unchanged and nothing is reported.
 *
 * PURE AND DB-FREE, like the modules it runs between.
 */
import { isLinkOnlyLine } from './sourceQuality.js'

/**
 * Links in one unbroken run before it counts as navigation.
 *
 * Counted in LINKS rather than in lines, since a navigation bar can be one line
 * carrying a dozen of them. Four is a "related reviews" box at the foot of an
 * article; five upwards, with no prose between any of them, is a menu.
 */
export const NAVIGATION_RUN_LINES = 5

/**
 * Headings whose section is plot.
 *
 * Deliberately exact. "Plot and structure" is missed, which costs budget;
 * "Summary" is not matched, which would cost an essay its own conclusion.
 */
const PLOT_HEADING =
  /^(#{1,6})\s*(?:plot|synopsis|storyline|plot summary|plot synopsis|synopsis of the plot)\s*:?\s*$/i

const HEADING = /^(#{1,6})\s/

/** Words a non-link line may have and still be part of a menu around it. */
const FILLER_WORDS = 3

/**
 * A line that holds a menu together without being one of its links: a category
 * label ("Movies", "TV shows"), a code-fence, a bullet on its own.
 *
 * Checked only INSIDE a run, never to start one, and a sentence terminator
 * disqualifies it - the point is to bridge "Movies" between two navigation
 * bars, not to swallow a short sentence at the end of a paragraph.
 */
function isRunFiller(line: string): boolean {
  const bare = line.replace(/[#*_`>|[\]()!-]/g, ' ').trim()
  if (bare.length === 0) return true
  if (/[.!?。]/.test(bare)) return false
  return bare.split(/\s+/).filter(Boolean).length <= FILLER_WORDS
}

/**
 * Drop every run of link-only lines heavy enough to be a menu.
 *
 * MEASURED IN LINKS, NOT IN LINES, because a scraped navigation bar is not one
 * link per line. IMDb's is one LINE carrying a dozen - `[Release
 * calendar](…)[Top 250 movies](…)[Most popular movies](…)…` - so a rule
 * counting consecutive lines sees a run of one and leaves the largest single
 * waste in the retrieval untouched. A caption or a "read more" is one link; a
 * line with twelve is a menu by itself.
 *
 * FILLER BRIDGES A RUN. A menu is link bars separated by their own category
 * labels ("Movies", "TV shows", "Watch") and by code fences, and treating those
 * as the end of a run cuts every real menu into pieces below the threshold.
 * Blank lines bridge it for the same reason.
 *
 * ONLY UP TO THE LAST LINK IS CUT, so filler sitting between the menu and the
 * article that follows it - which is usually the article's own heading - is
 * never taken with it.
 */
export function stripNavigationRuns(text: string): string {
  const lines = text.split('\n')
  const keep = new Array<boolean>(lines.length).fill(true)

  let runStart = -1
  let lastLink = -1
  let weight = 0
  const closeRun = () => {
    if (weight >= NAVIGATION_RUN_LINES && runStart >= 0) {
      for (let i = runStart; i <= lastLink; i += 1) keep[i] = false
    }
    runStart = -1
    lastLink = -1
    weight = 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (isLinkOnlyLine(line)) {
      if (runStart < 0) runStart = i
      lastLink = i
      weight += Math.max(1, (line.match(/\]\(/g) ?? []).length)
      continue
    }
    if (runStart >= 0 && isRunFiller(line)) continue
    closeRun()
  }
  closeRun()

  return lines.filter((_, i) => keep[i]).join('\n')
}

/**
 * Drop each plot section, from its heading to the next heading at the same or a
 * higher level.
 *
 * The level comparison is what keeps a "### Plot" inside a "## Production"
 * section from swallowing the rest of Production: a deeper heading continues
 * the section being removed, a shallower or equal one ends it.
 */
export function stripPlotSections(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let removingAt: number | null = null

  for (const line of lines) {
    if (removingAt != null) {
      const heading = HEADING.exec(line)
      if (heading && heading[1].length <= removingAt) {
        removingAt = null
      } else {
        continue
      }
    }
    const plot = PLOT_HEADING.exec(line)
    if (plot) {
      removingAt = plot[1].length
      continue
    }
    out.push(line)
  }

  return out.join('\n')
}

export interface CleanableSource {
  domain: string
  text: string
}

export interface CleanedSource {
  domain: string
  /** Characters removed, for the retrieval log and the bench report. */
  stripped: number
}

/** One page cleaned, or returned untouched when cleaning would empty it. */
export function cleanSourceText(text: string): { text: string; stripped: number } {
  const cleaned = stripPlotSections(stripNavigationRuns(text))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length === 0) return { text, stripped: 0 }
  return { text: cleaned, stripped: Math.max(0, text.length - cleaned.length) }
}

/**
 * Clean every page, reporting what each one lost.
 *
 * Returns documents in their original order, since that is relevance order and
 * everything downstream depends on it.
 */
export function cleanSources<T extends CleanableSource>(
  sources: readonly T[]
): { kept: T[]; cleaned: CleanedSource[] } {
  const cleaned: CleanedSource[] = []
  const kept = sources.map((source) => {
    const result = cleanSourceText(source.text)
    if (result.stripped === 0) return source
    cleaned.push({ domain: source.domain, stripped: result.stripped })
    return { ...source, text: result.text }
  })
  return { kept, cleaned }
}
