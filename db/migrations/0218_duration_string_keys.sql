-- Migration: 0218_duration_string_keys
-- Description: Follow the duration strings to their new keys.
--
-- They moved from admin.jobsPage.ui.* to common.duration.* because a page outside
-- the job console now reads them. An override an admin saved under the old key
-- would otherwise stop applying with nothing to say so.
UPDATE i18n_overrides SET key = 'common.duration.ms' WHERE key = 'admin.jobsPage.ui.durationMs';
UPDATE i18n_overrides SET key = 'common.duration.sec' WHERE key = 'admin.jobsPage.ui.durationSec';
UPDATE i18n_overrides SET key = 'common.duration.minSec' WHERE key = 'admin.jobsPage.ui.durationMinSec';
UPDATE i18n_overrides SET key = 'common.duration.hrMin' WHERE key = 'admin.jobsPage.ui.durationHrMin';
