-- Which prompt wrote each stored analysis.
--
-- prompt_version says which numbered version's questions were asked, and until
-- now that was the whole answer. A prompt VARIANT (packages/core/src/analysis/
-- promptVariants.ts) is an alternative set of questions and rules for the same
-- version, for a model that cannot hold that version's own -- so once the
-- Title Analysis role can be pointed at one, two articles written under the
-- same version number can be two different kinds of article, and without this
-- column nothing can tell them apart.
--
-- NULL means the version's own prompt, which is every row written before this
-- and every row written while the setting is unset.
ALTER TABLE title_analysis
  ADD COLUMN IF NOT EXISTS prompt_variant TEXT;
