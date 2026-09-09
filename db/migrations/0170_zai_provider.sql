-- Migration: Add Z.AI as a supported AI provider
--
-- Z.AI (GLM) speaks the OpenAI wire format at its own base URL, so it needs no
-- new SDK package — but it does need to be a NAMED provider rather than another
-- "OpenAI-Compatible" base URL, for the same reason LM Studio did in 0168: only
-- a named provider can ship a model catalog, price its models, know that its
-- GLM-5.x models force a reasoning scratchpad on, or explain itself in setup.
--
-- Unlike the other entries in this constraint, Z.AI is a cloud provider that
-- ships built-in models AND accepts custom ones. Its catalog moves faster than
-- this repo does — six GLM generations inside eighteen months, with the docs
-- retiring a model's page as soon as it is superseded — so the shipped list is
-- a floor and the custom table is how an operator reaches anything newer.
--
-- This constraint is deliberately not derived from the TypeScript list (see
-- F-002): it guards providers, which change only when an integration is
-- written, so a new entry there arrives with a migration like this one.

DO $$ BEGIN RAISE NOTICE '[0170] Adding zai to custom_ai_models provider constraint...'; END $$;

ALTER TABLE custom_ai_models
DROP CONSTRAINT IF EXISTS custom_ai_models_provider_check;

ALTER TABLE custom_ai_models
ADD CONSTRAINT custom_ai_models_provider_check
CHECK (provider IN ('ollama', 'lmstudio', 'openai-compatible', 'openrouter', 'huggingface', 'zai'));

DO $$ BEGIN RAISE NOTICE '[0170] Z.AI provider support added!'; END $$;
