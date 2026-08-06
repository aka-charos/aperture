-- Multi-centroid taste profiles
-- Additive alongside the single overall centroid in user_taste_profiles.embedding
-- (kept unchanged -- still used by tasteAnalyzer's dispersion scoring and as the
-- K=1 fallback). Multiple per-(user_id, media_type) taste centroids, computed via
-- deterministic spherical k-means over engagement-weighted watch history
-- (packages/core/src/taste-profile/clustering.ts), used as independent pgvector
-- query vectors during candidate retrieval so a user's distinct taste facets
-- (e.g. gritty crime dramas AND whimsical animated comedies) don't get averaged
-- away into one meaningless "semantic middle" vector.
--
-- Modeled on user_custom_interests (migration 0085): many rows per
-- (user_id, media_type), no ANN index (read as <=3 query vectors per
-- recommendation run, never searched against), unconstrained halfvec to match
-- user_taste_profiles' variable-dimension handling (migration 0086).
--
-- No is_locked/refresh_interval_days columns here -- clusters piggyback
-- entirely on user_taste_profiles' existing staleness/lock decision (one
-- policy, not two to keep in sync) and are rebuilt (delete+insert) in the same
-- pass as the overall profile, in getUserTasteProfile().

CREATE TABLE user_taste_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
    cluster_index INTEGER NOT NULL CHECK (cluster_index >= 0),  -- 0-based, descending by weight (0 = dominant taste facet)
    embedding halfvec NOT NULL,
    embedding_model TEXT,
    weight NUMERIC NOT NULL CHECK (weight > 0 AND weight <= 1),  -- share of engagement mass; sums to 1 across one user's clusters
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),  -- watch-history items assigned to this cluster
    dispersion NUMERIC,  -- 0-1 taste-dispersion score that drove this build's K choice, same scale as tasteAnalyzer's diversity score
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, media_type, cluster_index)
);

CREATE INDEX idx_user_taste_clusters_user_id ON user_taste_clusters(user_id, media_type);

CREATE TRIGGER trigger_user_taste_clusters_updated_at
    BEFORE UPDATE ON user_taste_clusters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
