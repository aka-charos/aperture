/**
 * Which prompt the library writer sends: the current version's own, or a
 * variant an operator chose for the model they are running.
 *
 * WHY A SETTING AT ALL. The prompt is written for a model that can hold it, and
 * the Title Analysis role is deliberately a free choice of provider and model —
 * including a 9B model on a local server. Measured on Fear and Loathing in Las
 * Vegas, version 15's ~2,000 words of mostly conditional rules produced one
 * paragraph on what the film was doing and two on its reception from
 * `ornith-1.5-9b`, which is the one proportion the prompt states as a cap. A
 * variant is the answer for that model without rewriting the version the larger
 * models follow correctly — see ./promptVariants.ts.
 *
 * READ ON THE WRITE PATH, NOT THE SETTINGS PAGE. `analyseTitle` calls this once
 * per title, above both prompt builds and the row that records which prompt
 * wrote the article, so what was sent and what the row names cannot disagree.
 *
 * IT NEVER THROWS, and that is the whole shape of this module. A stored id is a
 * setting; the work is a library pass costing retrieval and inference per
 * title. Refusing to write because a setting has gone stale would fail every
 * title in the run, so both refusals fall back to the version's own prompt and
 * say so once, in a line naming the id and the reason.
 */
import { getFunctionConfig } from '../lib/ai-provider.js'
import { createChildLogger } from '../lib/logger.js'
import { ANALYSIS_PROMPT_VERSION, libraryVariantFor } from './prompt.js'

const logger = createChildLogger('analysis-prompt')

/**
 * The variant id the writer should use, or null for the version's own prompt.
 *
 * Read from the role's primary provider config. A fallback model's config is
 * deliberately not consulted: the prompt is built ONCE per title and reused
 * across every attempt, so a second value there would describe a prompt no
 * request carries.
 */
export async function getAnalysisPromptVariant(): Promise<string | null> {
  const stored = (await getFunctionConfig('titleAnalysis'))?.analysisPromptVariant
  if (!stored) return null

  const variant = libraryVariantFor(stored)
  if (variant) return variant.id

  // Two ways to get here and the operator needs to be able to tell them apart:
  // the build no longer carries this id, or the version moved past the one it
  // varies. The second is the expected one and is why this is not an error —
  // every version bump rewrites the library anyway, and it rewrites it with the
  // new version's own prompt rather than with questions written for the old.
  logger.warn(
    { variant: stored, promptVersion: ANALYSIS_PROMPT_VERSION },
    'Configured analysis prompt variant is not usable with this prompt version — writing with the version\'s own prompt'
  )
  return null
}
