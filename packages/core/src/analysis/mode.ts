/**
 * Where the analysis gets its sources from.
 *
 * Two genuinely different approaches, kept switchable because they fail in
 * opposite directions and the only way to know which suits a library is to run
 * both over it:
 *
 *   'crw'       Self-hosted fastCRW searches and scrapes, and the model writes
 *               from article text placed in the prompt. No quota, so a whole
 *               library is reachable; the model does organisation rather than
 *               recall, which is what a small local model is good at. Costs
 *               retrieval time and depends on SearXNG's upstream engines.
 *
 *   'grounding' A Gemini model searches for itself through Google's native
 *               grounding. Higher quality retrieval and no infrastructure, but
 *               metered per day per Google project — measured at 20 requests a
 *               day on a free tier, which is what made a library-wide pass
 *               impossible and prompted the self-hosted path in the first
 *               place. Google-only: no other provider grounds natively.
 *
 * The mode is recorded on every row (`title_analysis.retrieval_mode`) so the
 * two can be compared after the fact rather than argued about:
 *
 *   SELECT retrieval_mode, model, count(*), count(analysis) AS kept,
 *          round(avg(length(analysis))) AS avg_chars
 *   FROM title_analysis GROUP BY 1, 2;
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { getFunctionConfig } from '../lib/ai-provider.js'
import { getCrwConfig, isCrwEnabled } from '../lib/crw.js'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('title-analysis-mode')

export type RetrievalMode = 'crw' | 'grounding'

const SETTING_KEY = 'title_analysis_retrieval'

/** Default is the self-hosted path: it is the one that can finish a library. */
export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = 'crw'

export function isRetrievalMode(value: unknown): value is RetrievalMode {
  return value === 'crw' || value === 'grounding'
}

export async function getRetrievalMode(): Promise<RetrievalMode> {
  const stored = await getSystemSetting(SETTING_KEY)
  return isRetrievalMode(stored) ? stored : DEFAULT_RETRIEVAL_MODE
}

export async function setRetrievalMode(mode: RetrievalMode): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    mode,
    'Where title analysis gets its sources: crw (self-hosted retrieval) or grounding (Gemini native search)'
  )
  logger.info({ mode }, 'Title analysis retrieval mode updated')
}

export interface ModeReadiness {
  mode: RetrievalMode
  ready: boolean
  /** Why not, in a sentence an operator can act on. Null when ready. */
  reason: string | null
}

/**
 * Whether the configured mode can actually run.
 *
 * Checked before a run rather than discovered mid-batch, because both failures
 * look identical from a job log — every title erroring — while their fixes are
 * on different settings pages. `grounding` additionally requires Google
 * specifically: it is the only provider with native search, so pointing the
 * role at OpenRouter or a local model and selecting grounding would produce
 * confident, unsourced prose about every film in the library, which is the one
 * outcome this feature exists to prevent.
 */
export async function checkModeReadiness(): Promise<ModeReadiness> {
  const mode = await getRetrievalMode()
  const roleConfig = await getFunctionConfig('titleAnalysis')

  if (!roleConfig) {
    return {
      mode,
      ready: false,
      reason: 'The Title Analysis model is not configured. Set it in Settings > AI.',
    }
  }

  if (mode === 'grounding') {
    if (roleConfig.provider !== 'google') {
      return {
        mode,
        ready: false,
        reason:
          'Built-in search needs a Google Gemini model — no other provider grounds natively. Choose Google in Settings > AI, or switch retrieval to the self-hosted service.',
      }
    }
    return { mode, ready: true, reason: null }
  }

  const crw = await getCrwConfig()
  if (!isCrwEnabled(crw)) {
    return {
      mode,
      ready: false,
      reason:
        'The retrieval service is not configured. Set it up in Settings > Integrations, or switch to a Gemini model with built-in search.',
    }
  }

  return { mode, ready: true, reason: null }
}
