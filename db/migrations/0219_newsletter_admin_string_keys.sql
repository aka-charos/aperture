-- Migration: 0219_newsletter_admin_string_keys
-- Description: Follow the newsletter editor strings to their new keys.
--
-- Everything under newsletters.* except subscription.* is admin console copy (the
-- editor, groups, toolbar, list, picker, status chips, field labels, analysis
-- parts), so it moved under admin.newsletters.*. Only newsletters.subscription.*
-- is read by a viewer page (Settings, NewsletterCard). An override an admin saved
-- under the old key would otherwise stop applying with nothing to say so.
UPDATE i18n_overrides
SET key = 'admin.' || key
WHERE key LIKE 'newsletters.%'
  AND key NOT LIKE 'newsletters.subscription.%';
