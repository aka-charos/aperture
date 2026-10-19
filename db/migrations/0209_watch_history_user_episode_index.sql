-- One viewer's watch rows for one episode, by index.
--
-- The assistant's watched filter (watchStatusCondition, apps/api assistant
-- tools/search.ts) is a correlated NOT EXISTS: for each candidate series it
-- asks whether THIS viewer played any of its episodes. That walks
-- episodes(series_id) and then needs watch_history by (user_id, episode_id).
-- Only episode_id alone was indexed (0032), so each probe read every viewer's
-- rows for every episode of the show and filtered on user_id afterwards, which
-- on a long-running show watched by a household is the expensive half.
--
-- Partial: movie rows carry no episode_id and never answer this question.
-- Not CONCURRENTLY, because the migration runner wraps each file in a
-- transaction; the table is one row per watched title, so the lock is brief.

CREATE INDEX IF NOT EXISTS idx_watch_history_user_episode
  ON watch_history (user_id, episode_id)
  WHERE episode_id IS NOT NULL;
