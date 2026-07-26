/**
 * Helper functions for the AI Assistant
 */
export { getMediaServerInfo, buildPlayLink } from './mediaServer.js'
export { applyN8nPreProcess } from './n8nPreProcess.js'
export { classifyIntent, latestUserText, type ChatIntent } from './routeIntent.js'
export { loadConversationHistory } from './conversationHistory.js'
export { withUnwatchedFilter, filterUnwatchedItems } from './unwatched.js'
export { createStatusEmitter, withStatusEvents, type StatusPhase, type StatusEmitter } from './status.js'
export { classifyAssistantError, assistantErrorText, toolErrorText, recordLlmError, type AssistantErrorCode } from './errors.js'

// Re-export from new prompts module
export { buildSystemPrompt, ASSISTANT_NAME } from '../prompts/index.js'
