-- Migration: Add LM Studio as a supported AI provider
--
-- LM Studio was previously reachable only as "OpenAI-Compatible", which meant
-- nothing could know which server was at the other end: no reading its catalog,
-- no per-model tool support, no setup help. It is a named provider now, and the
-- models it serves are per-install, so they live in custom_ai_models like every
-- other local server's.
--
-- This constraint is deliberately not derived from the TypeScript list (see
-- F-002): it guards providers, which change only when an integration is
-- written, so a new entry there arrives with a migration like this one.

DO $$ BEGIN RAISE NOTICE '[0168] Adding lmstudio to custom_ai_models provider constraint...'; END $$;

ALTER TABLE custom_ai_models
DROP CONSTRAINT IF EXISTS custom_ai_models_provider_check;

ALTER TABLE custom_ai_models
ADD CONSTRAINT custom_ai_models_provider_check
CHECK (provider IN ('ollama', 'lmstudio', 'openai-compatible', 'openrouter', 'huggingface'));

DO $$ BEGIN RAISE NOTICE '[0168] LM Studio provider support added!'; END $$;
