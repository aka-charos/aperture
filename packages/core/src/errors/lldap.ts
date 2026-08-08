/**
 * LLDAP Error Codes
 * https://github.com/lldap/lldap/blob/main/docs/scripting.md
 */

import type { ApiErrorDefinition } from './types.js'

/**
 * LLDAP error definitions mapped by HTTP status code
 */
export const LLDAP_ERRORS: Record<number, ApiErrorDefinition> = {
  // Authentication
  401: {
    type: 'auth',
    message: 'Invalid LLDAP admin credentials',
    action: 'Check the admin username and password in Settings → Integrations',
    severity: 'error',
  },
  403: {
    type: 'auth',
    message: "LLDAP account can't list other users (needs to be an admin account)",
    action: 'Use an LLDAP admin account for the email import',
    severity: 'error',
  },

  // Misconfiguration
  404: {
    type: 'validation',
    message: 'LLDAP server URL looks incorrect (endpoint not found)',
    action: 'Check the server URL in Settings → Integrations',
    severity: 'error',
  },

  // Server errors
  500: {
    type: 'outage',
    message: 'LLDAP server error. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 60,
    severity: 'info',
  },
  502: {
    type: 'outage',
    message: 'LLDAP gateway error. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  503: {
    type: 'outage',
    message: 'LLDAP is temporarily unavailable. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 60,
    severity: 'info',
  },
  504: {
    type: 'outage',
    message: 'LLDAP timeout. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
}
