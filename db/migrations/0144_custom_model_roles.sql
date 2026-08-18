-- Stop restating the AI role list in SQL.
--
-- `0089` created custom_ai_models with
--   CHECK (function_type IN ('embeddings','chat','textGeneration','exploration'))
-- and that list was never touched again. Two roles have been added since —
-- `webSearch` and `titleAnalysis` — so the database has been rejecting both for
-- as long as they have existed.
--
-- It surfaced only now because the two failures are not equally reachable.
-- `webSearch` is Google-only, and Google is not a custom-model provider, so
-- nothing could ever have tried. `titleAnalysis` is the opposite case: it
-- typically points at a local LM Studio model through `openai-compatible`, or a
-- cheap OpenRouter one, and all three of the catalogs that ship zero built-in
-- models (openai-compatible, openrouter, huggingface) require adding a custom
-- model per role. So for that role the rejected path is not an edge case, it is
-- the only path, and the failure was total: the dialog validated the model
-- against the provider, said "Model validated successfully!", and then the
-- INSERT tripped this constraint and returned a bare 500.
--
-- The list is DROPPED rather than extended, because a sixth copy of the role
-- enum would drift exactly as the first five did. `AI_FUNCTIONS`
-- (packages/core/src/lib/ai-capabilities/types.ts) is the one source of truth,
-- and it already reaches this table twice on the way in: the Fastify route
-- schema enums `function` against it (structurally pinned by
-- apps/api/src/routes/aiFunctionSchemas.test.ts, which fails on any role enum
-- that is not the shared list), and `addCustomModel` now narrows with
-- `isAIFunction` before issuing the INSERT. Both of those are derived. A CHECK
-- constraint cannot be, and TypeScript cannot see it — which is precisely how
-- it went stale twice without a single failing build.
--
-- What the constraint bought in exchange was nothing an application read: a
-- row with an unknown function_type is never selected, because every reader
-- queries `WHERE function_type = $1` for a role that exists.

ALTER TABLE custom_ai_models
  DROP CONSTRAINT IF EXISTS custom_ai_models_function_type_check;

COMMENT ON COLUMN custom_ai_models.function_type IS
  'AI role this model was added for. Deliberately unconstrained in SQL: the valid set is AI_FUNCTIONS in packages/core/src/lib/ai-capabilities/types.ts, enforced on the way in by the route schema enum and by isAIFunction in addCustomModel. Do not add a CHECK here — it went stale twice (webSearch, titleAnalysis) before it was removed.';

-- The provider list is deliberately left alone. It is the same shape of
-- constraint, but it has been maintained (0090 added openrouter, 0092 added
-- huggingface) and it guards a set that changes when an integration is written
-- rather than when a role is named — so it has not drifted and is not what
-- broke. If it ever does, the fix is this one, not another ALTER.
