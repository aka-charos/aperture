/**
 * Synopsis translation: the plot (`overview`) and full synopsis (`plot_full`)
 * machine-translated into the instance's enabled UI languages by a model at
 * any OpenAI-compatible endpoint — by default bilibili's free Index-Translate.
 *
 * Not to be confused with the admin "Translations" page, which edits the UI's
 * own strings (`i18n_overrides`). This translates library METADATA.
 */
export {
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
  sanitizeTranslationConfig,
  type TranslatableField,
  type TranslationConfig,
  type TranslationPromptStyle,
} from './rules.js'
export {
  TRANSLATION_TEST_TEXT,
  TranslationError,
  checkTranslationReadiness,
  getTranslationConfig,
  listTranslationModels,
  setTranslationConfig,
  translateText,
  type TranslationReadiness,
  type TranslationResult,
} from './client.js'
export {
  clearTranslations,
  getTranslationStatus,
  resolveLocalizedSynopsis,
  type LocalizedSynopsis,
  type TranslationLanguageStatus,
} from './store.js'
export {
  DEFAULT_MAX_TRANSLATIONS_PER_RUN,
  generateTitleTranslations,
  type TranslationJobOptions,
  type TranslationJobResult,
} from './job.js'
