/**
 * Where the SMTP settings live: one JSON blob in `system_settings`, like the
 * decision model and synopsis translation integrations, read and written only
 * through `sanitizeSmtpConfig` so a blob from an older build reads as whole.
 *
 * The password is stored in that blob as every other integration credential
 * here is; it never leaves the server — the settings route reports only
 * whether one is set.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { createChildLogger } from '../lib/logger.js'
import { DEFAULT_SMTP_CONFIG, sanitizeSmtpConfig, type SmtpConfig } from './rules.js'

const logger = createChildLogger('smtp')

const SETTING_KEY = 'smtp_integration'

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const json = await getSystemSetting(SETTING_KEY)
  if (json) {
    try {
      return sanitizeSmtpConfig(JSON.parse(json) as Partial<SmtpConfig>)
    } catch (err) {
      logger.error({ err }, 'Failed to parse smtp_integration config')
    }
  }
  return { ...DEFAULT_SMTP_CONFIG }
}

export async function setSmtpConfig(config: SmtpConfig): Promise<void> {
  await setSystemSetting(
    SETTING_KEY,
    JSON.stringify(sanitizeSmtpConfig(config)),
    'Outgoing mail server (SMTP) used to send email'
  )
  logger.info('SMTP configuration updated')
}
