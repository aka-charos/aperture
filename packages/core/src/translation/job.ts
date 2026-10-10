/**
 * The batch passes: translate pending synopses — or film analyses — into each
 * target language, in priority order, up to a per-run cap. Two jobs
 * (`translate-title-synopses`, `translate-title-analyses`) with their own
 * schedules and caps, and ONE loop ({@link runTranslationPass}), so the rules
 * below exist once. Shaped on `analysis/job.ts`, and for the same reasons:
 *
 * 1. EVERY PAIR IS ATTEMPTED AT MOST ONCE PER RUN. A failure writes no
 *    translation, so the pair stays pending — and a `title_translation_failures`
 *    row, which queues it LAST on every later run, since a pair that fails
 *    each time must not open each run. A loop reading until the selection
 *    empties would spin on it forever (the `enrichMetadata` `while (true)`
 *    lesson). Only a pair LEFT pending is sent back to SQL as an exclusion — a
 *    stored pair has already left the pending set, and an exclusion array of
 *    every pair tried is a `<> ALL` over thousands of entries on every row of
 *    every batch late in a large run. A JS set is the guarantee; the SQL list
 *    keeps the selection from spending its LIMIT on rows the set would skip.
 * 2. CANCELLATION IS POLLED BEFORE EVERY REQUEST, and inside the pacing wait.
 * 3. THE CAP COUNTS ATTEMPTED PAIRS, not stored rows — a failure costs the
 *    same wall-clock time as a success.
 *
 * The unit is a (title, language) PAIR. For synopses a pair is up to two
 * texts, one per switched-on field; for an analysis it is one text, which may
 * be several requests (`translateAnalysisText`). That is what the operator's
 * "translations per run" means.
 *
 * BOTH JOBS PACE ON THE SAME KEY. They share the endpoint, and the public one
 * limits tokens per minute per IP, so two jobs running at once take turns
 * rather than each spending the budget as if it were alone.
 */
import { query } from '../lib/db.js'
import { waitForCallSlot } from '../lib/callPacing.js'
import { createChildLogger } from '../lib/logger.js'
import type { AppLocaleCode } from '../lib/locales.js'
import { getSystemLanguageDefaults } from '../settings/systemSettings.js'
import type { ParagraphMap } from '../analysis/paragraphMap.js'
import {
  TranslationCancelledError,
  checkTranslationReadiness,
  getTranslationConfig,
  translateAnalysisText,
  translateText,
  type TranslateOptions,
  type TranslationResult,
} from './client.js'
import {
  analysisSourceSql,
  fieldPendingSql,
  pendingAnalysisTranslationsFromSql,
  pendingTranslationsFromSql,
  sourceColumnsSql,
  translationPriorityOrderSql,
} from './pending.js'
import {
  countPendingAnalysesByLanguage,
  countPendingByLanguage,
  recordTranslationFailure,
  storeTranslation,
} from './store.js'
import {
  ANALYSIS_TRANSLATION_FIELD,
  chatCompletionsUrl,
  enabledFields,
  resolveTargetLanguages,
  type TranslatableField,
  type TranslationConfig,
  type TranslationField,
} from './rules.js'

const logger = createChildLogger('translation-job')

/**
 * Pairs attempted per run unless the operator sets otherwise in the job's
 * schedule dialog. A synopsis takes seconds, not minutes, so this is sized as
 * a short pass against a free public endpoint rather than an overnight one.
 */
export const DEFAULT_MAX_TRANSLATIONS_PER_RUN = 300

/**
 * The same for film analyses. One analysis is one streamed request of about
 * 20 seconds into Greek (5,035 characters measured at 18.3s), and several when
 * it falls back to section by section, so a run of 100 is roughly half an hour
 * against the public endpoint.
 */
export const DEFAULT_MAX_ANALYSIS_TRANSLATIONS_PER_RUN = 100

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
  /** Texts stored. */
  translated: number
  /** Texts that failed; they stay pending. */
  failed: number
  cancelled: boolean
  budgetExhausted: boolean
}

/** One text of a pair, and how it is translated. */
interface WorkItem {
  field: TranslationField
  text: string
  /** md5 of `text`, computed by SQL from the expression the pending check hashes. */
  hash: string
  translate: (options: TranslateOptions) => Promise<TranslationResult & { detail?: string }>
}

interface PendingPair {
  mediaId: string
  title: string
  year: number | null
  language: AppLocaleCode
  /** This pair failed on an earlier run (it was queued last for that reason). */
  retry: boolean
  work: WorkItem[]
}

type PairRow = {
  id: string
  title: string
  year: number | null
  language: string
  retry: boolean
} & Record<string, unknown>

/** What makes a pass a synopsis pass or an analysis pass; the loop is the same. */
interface PassSpec {
  /** For log lines: "synopsis" / "film analysis". */
  noun: string
  /** What is translated, for the opening log line. */
  what: string
  countPending(mediaType: 'movie' | 'series'): Promise<number>
  select(
    mediaType: 'movie' | 'series',
    limit: number,
    leftPending: readonly string[]
  ): Promise<PendingPair[]>
}

const pairKey = (mediaId: string, language: string) => `${mediaId}:${language}`

// ---------------------------------------------------------------- synopses

async function selectPendingSynopsisPairs(
  config: TranslationConfig,
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
           (failed.last_failed_at IS NOT NULL) AS retry,
           ${sourceColumnsSql(fields)},
           ${pendingFlags}
     ${pendingTranslationsFromSql(mediaType, fields, '$1', { withPicks: true, withFailures: true })}
       AND (m.id::text || ':' || lang.code) <> ALL($2::text[])
     ${translationPriorityOrderSql()}
     LIMIT $3`,
    [languages, attempted, limit]
  )

  return rows.rows.map((row) => {
    const language = row.language as AppLocaleCode
    return {
      mediaId: row.id,
      title: row.title,
      year: row.year,
      language,
      retry: row.retry === true,
      work: fields
        .filter((f) => row[`${f}_pending`] === true && typeof row[`${f}_source`] === 'string')
        .map((f) => {
          const text = row[`${f}_source`] as string
          return {
            field: f,
            text,
            hash: row[`${f}_hash`] as string,
            translate: (options: TranslateOptions) => translateText(config, text, language, options),
          }
        }),
    }
  })
}

export async function generateTitleTranslations(
  options: TranslationJobOptions = {}
): Promise<TranslationJobResult> {
  const config = await getTranslationConfig()
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  const targets = resolveTargetLanguages(config, enabledUiLanguages)
  const fields = enabledFields(config)

  // Fail once, before any work, when the run cannot do anything — the
  // sentence lands on the job card instead of under N identical failures.
  if (!config.enabled) {
    throw new Error('Synopsis translation is switched off. Turn it on in Admin → AI → Synopsis translation.')
  }
  const readiness = checkTranslationReadiness(config, targets, 'synopsis')
  if (!readiness.ready) throw new Error(readiness.reason ?? 'Synopsis translation is not configured')

  return runTranslationPass(
    config,
    targets,
    {
      noun: 'synopsis',
      what: fields.join(' + '),
      async countPending(mediaType) {
        let total = 0
        for (const count of (await countPendingByLanguage(mediaType, fields, targets)).values()) total += count
        return total
      },
      select: (mediaType, limit, leftPending) =>
        selectPendingSynopsisPairs(config, mediaType, fields, targets, limit, leftPending),
    },
    options,
    DEFAULT_MAX_TRANSLATIONS_PER_RUN
  )
}

// ---------------------------------------------------------------- film analyses

async function selectPendingAnalysisPairs(
  config: TranslationConfig,
  mediaType: 'movie' | 'series',
  languages: readonly AppLocaleCode[],
  limit: number,
  attempted: readonly string[]
): Promise<PendingPair[]> {
  const src = analysisSourceSql()
  const rows = await query<PairRow>(
    `SELECT m.id, m.title, m.year, lang.code AS language,
           (failed.last_failed_at IS NOT NULL) AS retry,
           ${src} AS analysis_source, md5(${src}) AS analysis_hash,
           ta.paragraph_map
     ${pendingAnalysisTranslationsFromSql(mediaType, '$1', { withPicks: true, withFailures: true })}
       AND (m.id::text || ':' || lang.code) <> ALL($2::text[])
     ${translationPriorityOrderSql()}
     LIMIT $3`,
    [languages, attempted, limit]
  )

  return rows.rows
    .filter((row) => typeof row.analysis_source === 'string')
    .map((row) => {
      const language = row.language as AppLocaleCode
      const text = row.analysis_source as string
      const map = (row.paragraph_map ?? null) as ParagraphMap | null
      return {
        mediaId: row.id,
        title: row.title,
        year: row.year,
        language,
        retry: row.retry === true,
        work: [
          {
            field: ANALYSIS_TRANSLATION_FIELD,
            text,
            hash: row.analysis_hash as string,
            translate: async (options: TranslateOptions) => {
              const result = await translateAnalysisText(config, text, map, language, options)
              return {
                ...result,
                detail:
                  result.strategy === 'whole'
                    ? `${result.paragraphs} paragraphs in one request`
                    : `${result.paragraphs} paragraphs, section by section`,
              }
            },
          },
        ],
      }
    })
}

export async function generateAnalysisTranslations(
  options: TranslationJobOptions = {}
): Promise<TranslationJobResult> {
  const config = await getTranslationConfig()
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  const targets = resolveTargetLanguages(config, enabledUiLanguages)

  if (!config.analysisEnabled) {
    throw new Error(
      'Film analysis translation is switched off. Turn it on in Admin → AI → Synopsis translation, under Film analyses.'
    )
  }
  const readiness = checkTranslationReadiness(config, targets, 'analysis')
  if (!readiness.ready) throw new Error(readiness.reason ?? 'Film analysis translation is not configured')

  return runTranslationPass(
    config,
    targets,
    {
      noun: 'film analysis',
      what: 'film analyses',
      async countPending(mediaType) {
        let total = 0
        for (const count of (await countPendingAnalysesByLanguage(mediaType, targets)).values()) total += count
        return total
      },
      select: (mediaType, limit, leftPending) =>
        selectPendingAnalysisPairs(config, mediaType, targets, limit, leftPending),
    },
    options,
    DEFAULT_MAX_ANALYSIS_TRANSLATIONS_PER_RUN
  )
}

// ---------------------------------------------------------------- the loop

async function runTranslationPass(
  config: TranslationConfig,
  targets: readonly AppLocaleCode[],
  spec: PassSpec,
  options: TranslationJobOptions,
  defaultBudget: number
): Promise<TranslationJobResult> {
  const budget = options.maxPairs ?? defaultBudget
  const mediaTypes = options.mediaTypes ?? ['movie', 'series']
  const say = (level: 'info' | 'warn' | 'error', message: string) => options.onLog?.(level, message)

  const result: TranslationJobResult = {
    processed: 0,
    translated: 0,
    failed: 0,
    cancelled: false,
    budgetExhausted: false,
  }

  let total = 0
  for (const mediaType of mediaTypes) total += await spec.countPending(mediaType)
  const capped = Math.min(total, budget)
  const report = (current?: string) =>
    options.onProgress?.({ processed: result.processed, total: capped, current })
  report()

  say(
    'info',
    `🌐 ${total.toLocaleString()} title × language pair(s) pending into ${targets.join(', ')} ` +
      `(${spec.what}) — translating up to ${capped.toLocaleString()} this run ` +
      `with ${config.model} at ${new URL(chatCompletionsUrl(config.baseUrl) as string).host}`
  )
  if (capped === 0) say('info', `Nothing pending — every ${spec.noun} already has a current translation.`)

  const spacingMs = Math.round(config.callSpacingSeconds * 1000)
  // One key per endpoint, shared by both jobs: see the module comment.
  const pacingKey = `translation:${config.baseUrl}`
  let consecutiveFailures = 0
  let lastFailure = ''
  const cancelled = async () => (options.shouldCancel ? (await options.shouldCancel()) === true : false)

  for (const mediaType of mediaTypes) {
    // Every pair tried this run (the guarantee), and the subset still pending
    // after its attempt (what SQL must skip).
    const attempted = new Set<string>()
    const leftPending: string[] = []

    while (result.processed < budget) {
      if (await cancelled()) {
        result.cancelled = true
        return result
      }
      const pairs = await spec.select(mediaType, Math.min(SELECT_BATCH, budget - result.processed), leftPending)
      if (pairs.length === 0) break
      // A pair already tried can come back only if its translation went stale
      // again mid-run (the source changed under the job). It is not translated
      // twice: it joins the SQL exclusion and the batch is read again, which
      // always progresses because the exclusion list only grows.
      const fresh = pairs.filter((p) => !attempted.has(pairKey(p.mediaId, p.language)))
      if (fresh.length < pairs.length) {
        for (const p of pairs) {
          const key = pairKey(p.mediaId, p.language)
          if (attempted.has(key) && !leftPending.includes(key)) leftPending.push(key)
        }
        if (fresh.length === 0) continue
      }

      for (const pair of fresh) {
        if (result.processed >= budget) break
        const key = pairKey(pair.mediaId, pair.language)
        attempted.add(key)
        let calls = 0
        let pairFailed = false
        const label = `${pair.year ? `${pair.title} (${pair.year})` : pair.title} → ${pair.language}`
        report(label)
        result.processed++

        // Stopping before a pair's first call un-counts it; stopping between
        // its two fields does not, since one field was already stored and the
        // count is of pairs attempted.
        const stop = () => {
          if (calls === 0) result.processed--
          result.cancelled = true
          say('info', `🛑 Stopped during "${label}" — what was not translated stays pending`)
          report()
          return result
        }
        for (const item of pair.work) {
          if (await cancelled()) return stop()

          try {
            // Every request — each piece of a long text, each section of an
            // analysis, and each retry after a 429 — waits its pacing slot and
            // checks Stop first.
            const translation = await item.translate({
              beforeCall: async () => {
                if (await cancelled()) return false
                const paced = await waitForCallSlot(pacingKey, spacingMs, { shouldCancel: options.shouldCancel })
                if (paced.cancelled) return false
                calls++
                return true
              },
              onRateLimited: (waitMs, attempt) =>
                say(
                  'info',
                  `⏳ ${label} · ${item.field} — rate-limited by the endpoint, waiting ` +
                    `${Math.round(waitMs / 1000)}s before retry ${attempt}`
                ),
              onNote: (message) => say('info', `↪ ${label} · ${item.field} — ${message}`),
            })
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
                `${translation.text.length.toLocaleString()} chars in ${(translation.latencyMs / 1000).toFixed(1)}s` +
                (translation.detail ? ` (${translation.detail})` : '')
            )
          } catch (err) {
            if (err instanceof TranslationCancelledError) return stop()
            result.failed++
            pairFailed = true
            const reason = err instanceof Error ? err.message : String(err)
            await recordTranslationFailure({
              mediaType,
              mediaId: pair.mediaId,
              language: pair.language,
              field: item.field,
              sourceHash: item.hash,
              error: reason,
            })
            logger.warn(
              { err, mediaType, mediaId: pair.mediaId, language: pair.language, field: item.field },
              `${spec.noun} translation failed; leaving it pending`
            )
            say(
              'warn',
              `⚠️ ${label} · ${item.field} — failed${pair.retry ? ' again' : ''}, ` +
                `staying pending (queued after the rest next run): ${reason}`
            )
            // A pair that already failed on an earlier run says nothing new
            // about the endpoint: these are queued last on purpose, so a run
            // reaching them meets them back to back, and counting them would
            // end every run that gets that far in a false "endpoint is down".
            if (pair.retry) continue
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
        if (pairFailed) leftPending.push(key)
        report()
      }
    }
  }

  result.budgetExhausted = result.processed >= budget
  logger.info({ ...result, budget, kind: spec.noun }, 'Translation pass finished')
  say(
    'info',
    `🏁 Finished: ${result.translated} stored, ${result.failed} failed across ${result.processed} pair(s)` +
      (result.budgetExhausted ? ` (hit this run's limit of ${budget})` : '')
  )
  return result
}
