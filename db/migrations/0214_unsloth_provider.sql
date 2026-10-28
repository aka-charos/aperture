-- Migration: Add Unsloth Studio as a supported AI provider
--
-- Unsloth Studio serves its downloaded models through an OpenAI-compatible API,
-- so it was reachable as "OpenAI-Compatible" already, with the same blind spot
-- LM Studio had before 0168: nothing could read its model list or explain its
-- setup. It is a named provider now, and the models it serves are per-install,
-- so they live in custom_ai_models like every other local server's.
--
-- This constraint is deliberately not derived from the TypeScript list (see
-- F-002): it guards providers, which change only when an integration is
-- written, so a new entry there arrives with a migration like this one. The
-- list below is 0170's with 'unsloth' added.

DO $$ BEGIN RAISE NOTICE '[0214] Adding unsloth to custom_ai_models provider constraint...'; END $$;

ALTER TABLE custom_ai_models
DROP CONSTRAINT IF EXISTS custom_ai_models_provider_check;

ALTER TABLE custom_ai_models
ADD CONSTRAINT custom_ai_models_provider_check
CHECK (provider IN ('ollama', 'lmstudio', 'unsloth', 'openai-compatible', 'openrouter', 'huggingface', 'zai'));

DO $$ BEGIN RAISE NOTICE '[0214] Unsloth Studio provider support added!'; END $$;
