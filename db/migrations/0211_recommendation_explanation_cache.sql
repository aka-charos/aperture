-- Migration: 0211_recommendation_explanation_cache
-- Description: Keep each pick's written explanation beside a fingerprint of
-- everything the model was shown for it, so a regeneration that lands on the
-- same pick with the same inputs reuses the text instead of paying for it again.
--
-- A regeneration used to write every explanation from scratch. The ranking is
-- deterministic, so a regenerate with nothing new to go on returns mostly the
-- same picks, and the explanations were the slow, paid part of the run: one
-- model call per batch of picks, per viewer, per media type, rewording text
-- whose inputs had not changed.
--
-- Its own table, not a column on recommendation_candidates: "Regenerate" and
-- "Full reset" delete the viewer's runs before building the new one, so a
-- cache kept on the runs would be gone exactly when it is needed.
--
-- fingerprint: sha256 of the system prompt, the taste block, the pick's own
-- block and the writer (provider, model, reasoning setting), built by
-- recommender/shared/explanationReuse.ts. Anything that changes what the model
-- is shown changes it, prompt edits included, so nothing here needs a version
-- bump to invalidate.
-- explanation: model-written text only. The template written when a call fails
-- is never stored, or one failure would be reused forever.
--
-- One row per viewer, media type and title, trimmed to the picks of the
-- viewer's newest run on every write, so it stays the size of their lists.
-- item_id is a movie or a series id by media_type and carries no foreign key;
-- a title removed from the library leaves its row until that trim.

CREATE TABLE IF NOT EXISTS recommendation_explanation_cache (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
  item_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  explanation TEXT NOT NULL,
  written_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, media_type, item_id)
);

COMMENT ON TABLE recommendation_explanation_cache IS
  'Last model-written explanation per viewer, media type and pick, with a fingerprint of its inputs; reused by a regeneration when the fingerprint matches.';
