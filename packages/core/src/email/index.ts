export {
  DEFAULT_SMTP_CONFIG,
  SMTP_DEFAULT_PORTS,
  SMTP_FAILURES,
  SMTP_FROM_NAME_MAX_LENGTH,
  SMTP_PROBLEMS,
  SMTP_SECURITY_MODES,
  buildTransportOptions,
  classifySmtpFailure,
  isEmailAddress,
  isSmtpSecurity,
  sanitizeSmtpConfig,
  smtpConfigError,
  smtpProblems,
  storedPasswordFor,
  type SmtpConfig,
  type SmtpFailure,
  type SmtpProblem,
  type SmtpSecurity,
} from './rules.js'
export {
  sendWithSmtp,
  verifySmtp,
  type EmailSender,
  type OutgoingEmail,
  type SentEmail,
  type SmtpOutcome,
} from './smtp.js'
export { getSmtpConfig, setSmtpConfig } from './config.js'
export { sendEmail, sendTestEmail, senderFor } from './send.js'
