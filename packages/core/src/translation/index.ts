/**
 * Synopsis translation: the plot (`overview`) and full synopsis (`plot_full`)
 * — and, as a second job with its own switch and instructions, the stored film
 * analyses — machine-translated into the instance's enabled UI languages by a
 * model at any OpenAI-compatible endpoint, by default bilibili's free
 * Index-Translate.
 *
 * Not to be confused with the admin "Translations" page, which edits the UI's
 * own strings (`i18n_overrides`). This translates library METADATA.
 */
export {
  ANALYSIS_TRANSLATION_FIELD,
  DEFAULT_TRANSLATION_CONFIG,
  INDEX_TRANSLATE_BASE_URL,
  INDEX_TRANSLATE_DEFAULT_MODEL,
  TRANSLATABLE_FIELDS,
  TRANSLATION_INSTRUCTION_MAX_CHARS,
  TRANSLATION_PROMPT_STYLES,
  TRANSLATION_SPACING_MAX_SECONDS,
  TRANSLATION_TIMEOUT_MAX_MS,
  TRANSLATION_TIMEOUT_MIN_MS,
  chatCompletionsUrl,
  enabledFields,
  isTranslatableField,
  isTranslationPromptStyle,
  resolveTargetLanguages,
  resolveTranslationLanguages,
  sanitizeTranslationConfig,
  type TranslatableField,
  type TranslationConfig,
  type TranslationField,
  type TranslationKind,
  type TranslationPromptStyle,
} from './rules.js'
export {
  TRANSLATION_TEST_ANALYSIS_TEXT,
  TRANSLATION_TEST_TEXT,
  TranslationError,
  checkTranslationReadiness,
  getTranslationConfig,
  listTranslationModels,
  setTranslationConfig,
  translateAnalysisText,
  translateText,
  type AnalysisTranslationResult,
  type TranslationReadiness,
  type TranslationResult,
} from './client.js'
export {
  clearTranslations,
  getTranslationStatus,
  resolveLocalizedAnalysis,
  resolveLocalizedOverviews,
  resolveLocalizedSynopsis,
  type LocalizedAnalysis,
  type LocalizedSynopsis,
  type TranslationLanguageStatus,
} from './store.js'
export {
  DEFAULT_MAX_ANALYSIS_TRANSLATIONS_PER_RUN,
  DEFAULT_MAX_TRANSLATIONS_PER_RUN,
  generateAnalysisTranslations,
  generateTitleTranslations,
  type TranslationJobOptions,
  type TranslationJobResult,
} from './job.js'
