-- Approximate watch dates, recorded when a viewer rates something the media
-- server says they have never played and answers "when did you watch this?"
-- with a coarse band rather than a date.
--
-- The media server has no way to express "roughly": Emby stores one
-- LastPlayedDate and the watch-history sync overwrites ours from it on every
-- pass. So the fact that a date was estimated can only live here, and it has
-- to survive that sync — which it does, because the sync's ON CONFLICT lists
-- its columns explicitly and never touches this one.

-- The exact value we sent to the media server, NULL when the date is real.
--
-- Storing the date rather than a boolean is what lets the marker clear itself:
-- if the server's LastPlayedDate later stops matching what we wrote, an actual
-- play has happened since and the row is now exact. A boolean would leave
-- every backfilled title flagged approximate forever, including after the
-- viewer really watched it.
ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS approximate_played_at TIMESTAMPTZ;

COMMENT ON COLUMN watch_history.approximate_played_at IS
  'The estimated timestamp written to the media server when a viewer dated a watch by band rather than exactly. NULL means last_played_at is a real play. Rows with a value are counted as watches everywhere but excluded from hour-of-day and day-of-week charts, which would otherwise assert a viewing habit nobody reported.';

-- Partial: the overwhelming majority of history is real plays, and the only
-- queries that care are the ones filtering for the exception.
CREATE INDEX IF NOT EXISTS idx_watch_history_approximate
  ON watch_history(user_id)
  WHERE approximate_played_at IS NOT NULL;

-- "I haven't seen it" — the named dismissal on that same prompt.
--
-- It lives on the rating because that is what it qualifies: the rating is an
-- expectation rather than a verdict. It is deliberately not a watch_history
-- row, because there is no watch to record. Deleting the rating takes the
-- declaration with it, which is correct — the question becomes open again.
--
-- Nothing reads this yet beyond suppressing a repeat prompt. It exists now
-- because the batch prompt ("9 films you rated aren't marked watched") would
-- otherwise resurface a genuinely unwatched title every time forever, with no
-- way for anyone to make it stop, and retrofitting the flag after people have
-- rated their way through a back catalogue is too late to help them.
ALTER TABLE user_ratings ADD COLUMN IF NOT EXISTS not_watched_declared_at TIMESTAMPTZ;

COMMENT ON COLUMN user_ratings.not_watched_declared_at IS
  'Set when the viewer explicitly answered that they have not seen this title, as opposed to dismissing the prompt. NULL means unasked or unanswered.';
