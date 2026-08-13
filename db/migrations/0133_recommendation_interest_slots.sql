-- Make the reserved-slot budget visible and configurable.
--
-- Recs Per User is a budget: ranked picks, custom-interest slots and taste-twin
-- slots all spend from it. Until now only one of the three spenders had a
-- control, and even that one was overridden by a hidden constant -- the slot
-- count could never exceed 20% of the list however it was configured, so an
-- admin who set 4 twin picks against 10 recommendations silently got 2. A
-- setting that does not mean what it says is worse than no setting.
--
-- So: interest slots gain the ceiling twin slots already had, and both
-- INTEREST_SLOT_SHARE and TWIN_SLOT_SHARE are deleted from the arithmetic. The
-- configured numbers are now authoritative, bounded only by what actually
-- exists (interests the user wrote, twins that cleared the bar) and by the
-- length of the list itself. The UI enforces the budget in the controls rather
-- than clamping afterwards.
--
-- Default 3 preserves today's behaviour at typical list lengths: the old
-- MAX_INTEREST_SLOTS was also 3, and the share only bound below ~15
-- recommendations. Short lists do gain a slot -- at 10 recs the share used to
-- cap interests at 2, and 3 is now what the setting says and what happens.
--
-- SCORING_FIELDS, like the twin columns in 0132: this decides which titles
-- reach the final list, so an edit has to bump scoring_updated_at or the
-- activity gate would conclude nothing had changed.

ALTER TABLE recommendation_config
  ADD COLUMN IF NOT EXISTS movie_interest_max_slots INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS series_interest_max_slots INTEGER NOT NULL DEFAULT 3;

ALTER TABLE recommendation_config
  DROP CONSTRAINT IF EXISTS recommendation_config_interest_check;

ALTER TABLE recommendation_config
  ADD CONSTRAINT recommendation_config_interest_check
  CHECK (
    movie_interest_max_slots >= 0 AND movie_interest_max_slots <= 10 AND
    series_interest_max_slots >= 0 AND series_interest_max_slots <= 10
  );

COMMENT ON COLUMN recommendation_config.movie_interest_max_slots IS
  'Ceiling on movie recommendations reserved for the user''s stated interests (0 disables). Cannot exceed what is left of selected_count after twin slots';
COMMENT ON COLUMN recommendation_config.series_interest_max_slots IS
  'Ceiling on series recommendations reserved for the user''s stated interests (0 disables). Cannot exceed what is left of selected_count after twin slots';
