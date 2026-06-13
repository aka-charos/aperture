/**
 * Helper functions for the AI Assistant
 */
export { getMediaServerInfo, buildPlayLink } from './mediaServer.js'
export { applyN8nPreProcess } from './n8nPreProcess.js'

// Re-export from new prompts module
export { buildSystemPrompt, ASSISTANT_NAME } from '../prompts/index.js'
