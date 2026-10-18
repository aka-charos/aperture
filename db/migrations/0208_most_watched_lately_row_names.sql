-- Top Picks rows on the Emby home screen are renamed "Most Watched Lately":
-- the list is what the server streamed most recently, not anyone's pick.
-- Only rows still carrying the old default move; a name an admin typed stays.
UPDATE home_sections_config SET top_picks_movies_name = 'Most Watched Lately: Movies'
  WHERE top_picks_movies_name = 'Top Picks: Movies';
UPDATE home_sections_config SET top_picks_series_name = 'Most Watched Lately: Series'
  WHERE top_picks_series_name = 'Top Picks: Series';
ALTER TABLE home_sections_config
  ALTER COLUMN top_picks_movies_name SET DEFAULT 'Most Watched Lately: Movies',
  ALTER COLUMN top_picks_series_name SET DEFAULT 'Most Watched Lately: Series';
