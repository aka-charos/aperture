/**
 * The batch pass: translate pending synopses into each target language, in
 * priority order, up to a per-run cap. Shaped on `analysis/job.ts`, and for
 * the same three reasons:
 *
 * 1. EVERY PAIR IS ATTEMPTED AT MOST ONCE PER RUN. A failure writes no row, so
 *    the pair stays pending; a loop reading until the selection empties would
 *    spin on it forever (the `enrichMetadata` `while (true)` lesson).
 * 2. CANCELLATION IS POLLED BETWEEN CALLS, and inside the pacing wait.
 * 3. THE CAP COUNTS ATTEMPTED PAIRS, not stored rows — a failure costs the
 *    same wall-clock time as a success.
 *
 * The unit is a (title, language) PAIR: one pair is up to two calls, one per
 * switched-on field. That is what the operator's "translations per run" means.
 */
import { query } from '../lib/db.js'
import { waitForCallSlot } from '../lib/callPacing.js'
import { createChildLogger } from '../lib/logger.js'
import type { AppLocaleCode } from '../lib/locales.js'
import { getSystemLanguageDefaults } from '../settings/systemSettings.js'
import { checkTranslationReadiness, getTranslationConfig, translateText } from './client.js'
import {
  fieldPendingSql,
  pendingTranslationsFromSql,
  sourceColumnsSql,
  translationPriorityOrderSql,
} from './pending.js'
import { countPendingByLanguage, storeTranslation } from './store.js'
import {
  chatCompletionsUrl,
  enabledFields,
  resolveTargetLanguages,
  type TranslatableField,
} from './rules.js'

const logger = createChildLogger('translation-job')

/**
 * Pairs attempted per run unless the operator sets otherwise in the job's
 * schedule dialog. A synopsis takes seconds, not minutes, so this is sized as
 * a short pass against a free public endpoint rather than an overnight one.
 */
export const DEFAULT_MAX_TRANSLATIONS_PER_RUN = 300

const SELECT_BATCH = 25

/**
 * Consecutive failed calls that mean the endpoint, not the text: unreachable,
 * rate-limited, a wrong model id, or a model that cannot follow the prompt.
 * Five in a row stops the run and says which, rather than spending the rest
 * of the cap proving it (analysis/job.ts's CONSECUTIVE_FAILURE_LIMIT).
 */
const CONSECUTIVE_FAILURE_LIMIT = 5

export interface TranslationJobOptions {
  maxPairs?: number
  mediaTypes?: Array<'movie' | 'series'>
  shouldCancel?: () => Promise<boolean> | boolean
  onProgress?: (progress: { processed: number; total: number; current?: string }) => void
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface TranslationJobResult {
  /** Pairs attempted. */
  processed: number
  /** Fields stored. */
  translated: number
  /** Calls that failed; their fields stay pending. */
  failed: number
  cancelled: boolean
  budgetExhausted: boolean
}

interface PendingPair {
  mediaType: 'movie' | 'series'
  mediaId: string
  title: string
  year: number | null
  language: AppLocaleCode
  work: Array<{ field: TranslatableField; text: string; hash: string }>
}

type PairRow = {
  id: string
  title: string
  year: number | null
  language: string
} & Record<string, unknown>

async function selectPendingPairs(
  mediaType: 'movie' | 'series',
  fields: readonly TranslatableField[],
  languages: readonly AppLocaleCode[],
  limit: number,
  attempted: readonly string[]
): Promise<PendingPair[]> {
  const pendingFlags = fields
    .map((f) => `${fieldPendingSql(mediaType, f, 'lang.code')} AS ${f}_pending`)
    .join(',\n           ')
  const rows = await query<PairRow>(
    `SELECT m.id, m.title, m.year, lang.code AS language,
           ${sourceColumnsSql(fields)},
           ${pendingFlags}
     ${pendingTranslationsFromSql(mediaType, fields, '$1', { withPicks: true })}
       AND (m.id::text || ':' || lang.code) <> ALL($2::text[])
     ${translationPriorityOrderSql()}
     LIMIT $3`,
    [languages, attempted, limit]
  )

  return rows.rows.map((row) => ({
    mediaType,
    mediaId: row.id,
    title: row.title,
    year: row.year,
    language: row.language as AppLocaleCode,
    work: fields
      .filter((f) => row[`${f}_pending`] === true && typeof row[`${f}_source`] === 'string')
      .map((f) => ({
        field: f,
        text: row[`${f}_source`] as string,
        hash: row[`${f}_hash`] as string,
      })),
  }))
}

const pairKey = (mediaId: string, language: string) => `${mediaId}:${language}`

export async function generateTitleTranslations(
  options: TranslationJobOptions = {}
): Promise<TranslationJobResult> {
  const budget = options.maxPairs ?? DEFAULT_MAX_TRANSLATIONS_PER_RUN
  const mediaTypes = options.mediaTypes ?? ['movie', 'series']
  const say = (level: 'info' | 'warn' | 'error', message: string) => options.onLog?.(level, message)

  const result: TranslationJobResult = {
    processed: 0,
    translated: 0,
    failed: 0,
    cancelled: false,
    budgetExhausted: false,
  }

  const config = await getTranslationConfig()
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  const targets = resolveTargetLanguages(config, enabledUiLanguages)
  const fields = enabledFields(config)

  // Fail once, before any work, when the run cannot do anything — the
  // sentence lands on the job card instead of under N identical failures.
  if (!config.enabled) {
    throw new Error('Synopsis translation is switched off. Turn it on in Admin → AI → Synopsis translation.')
  }
  const readiness = checkTranslationReadiness(config, targets)
  if (!readiness.ready) throw new Error(readiness.reason ?? 'Synopsis translation is not configured')

  let total = 0
  for (const mediaType of mediaTypes) {
    for (const count of (await countPendingByLanguage(mediaType, fields, targets)).values()) total += count
  }
  const capped = Math.min(total, budget)
  const report = (current?: string) =>
    options.onProgress?.({ processed: result.processed, total: capped, current })
  report()

  say(
    'info',
    `🌐 ${total.toLocaleString()} title × language pair(s) pending into ${targets.join(', ')} ` +
      `(${fields.join(' + ')}) — translating up to ${capped.toLocaleString()} this run ` +
      `with ${config.model} at ${new URL(chatCompletionsUrl(config.baseUrl) as string).host}`
  )
  if (capped === 0) say('info', 'Nothing pending — every synopsis already has a current translation.')

  const spacingMs = Math.round(config.callSpacingSeconds * 1000)
  const pacingKey = `translation:${config.baseUrl}`
  let consecutiveFailures = 0
  let lastFailure = ''
  const cancelled = async () => (options.shouldCancel ? (await options.shouldCancel()) === true : false)

  for (const mediaType of mediaTypes) {
    const attempted: string[] = []

    while (result.processed < budget) {
      if (await cancelled()) {
        result.cancelled = true
        return result
      }
      const pairs = await selectPendingPairs(
        mediaType,
        fields,
        targets,
        Math.min(SELECT_BATCH, budget - result.processed),
        attempted
      )
      if (pairs.length === 0) break

      for (const pair of pairs) {
        if (result.processed >= budget) break
        attempted.push(pairKey(pair.mediaId, pair.language))
        const label = `${pair.year ? `${pair.title} (${pair.year})` : pair.title} → ${pair.language}`
        report(label)
        result.processed++

        for (const item of pair.work) {
          if (await cancelled()) {
            result.processed--
            result.cancelled = true
            say('info', `🛑 Stopped during "${label}" — it stays pending`)
            report()
            return result
          }
          const paced = await waitForCallSlot(pacingKey, spacingMs, { shouldCancel: options.shouldCancel })
          if (paced.cancelled) {
            result.processed--
            result.cancelled = true
            report()
            return result
          }

          try {
            const translation = await translateText(config, item.text, pair.language)
            await storeTranslation({
              mediaType,
              mediaId: pair.mediaId,
              language: pair.language,
              field: item.field,
              sourceHash: item.hash,
              text: translation.text,
              model: translation.model,
            })
            result.translated++
            consecutiveFailures = 0
            say(
              'info',
              `✅ ${label} · ${item.field} — ${item.text.length.toLocaleString()} → ` +
                `${translation.text.length.toLocaleString()} chars in ${(translation.latencyMs / 1000).toFixed(1)}s`
            )
          } catch (err) {
            result.failed++
            const reason = err instanceof Error ? err.message : String(err)
            logger.warn(
              { err, mediaType, mediaId: pair.mediaId, language: pair.language, field: item.field },
              'Synopsis translation failed; leaving it pending'
            )
            say('warn', `⚠️ ${label} · ${item.field} — failed, staying pending: ${reason}`)
            consecutiveFailures++
            lastFailure = reason
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
              const message =
                `Stopped after ${consecutiveFailures} failed translations in a row — this is the ` +
                `endpoint or the model, not these titles. Last error: ${lastFailure}`
              say('error', `🛑 ${message} — ${result.translated} stored before this; the rest stay pending.`)
              throw new Error(message)
            }
          }
        }
        report()
      }
    }
  }

  result.budgetExhausted = result.processed >= budget
  logger.info({ ...result, budget }, 'Synopsis translation pass finished')
  say(
    'info',
    `🏁 Finished: ${result.translated} stored, ${result.failed} failed across ${result.processed} pair(s)` +
      (result.budgetExhausted ? ` (hit this run's limit of ${budget})` : '')
  )
  return result
}
