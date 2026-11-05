-- Migration: 0220_admin_common_string_keys
-- Description: Follow the admin-only common/nav strings to their new keys.
--
-- Six common.* words and nav.admin are read only by admin console pages, so they
-- moved under admin.* (admin.common.*, admin.nav.admin) to keep the viewer
-- namespaces viewer-only. An override an admin saved under the old key would
-- otherwise stop applying with nothing to say so.
UPDATE i18n_overrides
SET key = 'admin.' || key
WHERE key IN (
  'common.saving',
  'common.clear',
  'common.confirm',
  'common.delete',
  'common.later',
  'common.dontShowAgain',
  'nav.admin'
);
