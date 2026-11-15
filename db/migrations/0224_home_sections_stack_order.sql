-- Migration: 0224_home_sections_stack_order
-- Description: The operator chooses which feature's rows come first when
--              several land on the same spot of a home screen (two rows both
--              placed after the same row, say).
--
-- NULL means the order nobody chose: the order of `PLACEMENT_FEATURES`, which
-- is what every home screen got before this migration. Nothing moves on
-- anybody's home screen until an order is saved, and then only the rows of the
-- features whose place in the order changed.
--
-- Feature names are not checked here: the vocabulary lives in code (see 0188),
-- and a stored order is read through `normaliseStackOrder`, which drops a name
-- it does not know and appends a feature the order does not name.

ALTER TABLE home_sections_config
  ADD COLUMN IF NOT EXISTS stack_order TEXT[];

COMMENT ON COLUMN home_sections_config.stack_order IS
  'Feature names, first on top, for rows that resolve to the same spot. NULL = the default order.';
