/**
 * Which credentials are read from Bitwarden, and linking or unlinking one.
 *
 * A link is the credential's own settings row holding `bws:<secret name>`
 * (`rules.ts`). Linking replaces whatever the row held; unlinking removes the
 * row, because the credential it once held is gone and nothing here ever
 * copies a secret's value into the database.
 *
 * Built over injected reads and writes (`createSecretBindings`) so the rules
 * above are tested without a database or a vault.
 */
import {
  deleteSystemSetting,
  getSystemSettingRaw,
  getSystemSettingsRaw,
  setSystemSetting,
} from '../settings/systemSettings.js'
import { lookupBitwardenSecret } from './bitwarden.js'
import {
  BINDABLE_SECRETS,
  bindableSecret,
  isSecretName,
  parseSecretRef,
  secretRefFor,
  type BindableSecretId,
  type SecretLookup,
} from './rules.js'

export interface SecretBinding {
  id: BindableSecretId
  /** `none`: nothing saved. `stored`: the credential is in the database. */
  source: 'none' | 'stored' | 'bitwarden'
  /** The linked secret's name, when the source is Bitwarden. */
  secretName: string | null
  /**
   * For a linked credential: whether its secret can be read right now, or why
   * not. Null for the other sources.
   */
  state: SecretLookup['status'] | null
}

export type BindSecretResult =
  | { ok: true }
  | { ok: false; reason: 'unknownCredential' | 'invalidName' | Exclude<SecretLookup['status'], 'ok'> }

export type UnbindSecretResult = { ok: true } | { ok: false; reason: 'unknownCredential' | 'notLinked' }

export interface SecretBindingsDeps {
  /** Settings exactly as stored: a reference stays a reference. */
  readRaw: (key: string) => Promise<string | null>
  readManyRaw: (keys: readonly string[]) => Promise<Map<string, string>>
  write: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
  lookup: (name: string) => Promise<SecretLookup>
}

export function createSecretBindings(deps: SecretBindingsDeps) {
  async function list(): Promise<SecretBinding[]> {
    const stored = await deps.readManyRaw(BINDABLE_SECRETS.map((s) => s.settingKey))
    const bindings: SecretBinding[] = []
    for (const { id, settingKey } of BINDABLE_SECRETS) {
      const value = stored.get(settingKey) ?? null
      const secretName = parseSecretRef(value)
      if (secretName !== null) {
        const found = await deps.lookup(secretName)
        bindings.push({ id, source: 'bitwarden', secretName, state: found.status })
      } else {
        bindings.push({ id, source: value?.trim() ? 'stored' : 'none', secretName: null, state: null })
      }
    }
    return bindings
  }

  /** Whether a credential is read from Bitwarden, whatever state its secret is in. */
  async function isLinked(id: BindableSecretId): Promise<boolean> {
    const target = bindableSecret(id)
    if (!target) return false
    return parseSecretRef(await deps.readRaw(target.settingKey)) !== null
  }

  /**
   * Read a credential from the named Bitwarden secret from now on.
   *
   * Refused unless the secret can be read at this moment: a link to a name
   * that is missing, empty or shared by two secrets would silently switch the
   * integration off.
   */
  async function bind(id: string, secretName: unknown): Promise<BindSecretResult> {
    const target = bindableSecret(id)
    if (!target) return { ok: false, reason: 'unknownCredential' }
    if (!isSecretName(secretName)) return { ok: false, reason: 'invalidName' }
    const found = await deps.lookup(secretName)
    if (found.status !== 'ok') return { ok: false, reason: found.status }
    await deps.write(target.settingKey, secretRefFor(secretName))
    return { ok: true }
  }

  /**
   * Stop reading a credential from Bitwarden. Only a link is removed: a
   * credential stored in the database is the integration card's to change.
   */
  async function unbind(id: string): Promise<UnbindSecretResult> {
    const target = bindableSecret(id)
    if (!target) return { ok: false, reason: 'unknownCredential' }
    if (parseSecretRef(await deps.readRaw(target.settingKey)) === null) return { ok: false, reason: 'notLinked' }
    await deps.remove(target.settingKey)
    return { ok: true }
  }

  return { list, isLinked, bind, unbind }
}

const bindings = createSecretBindings({
  readRaw: getSystemSettingRaw,
  readManyRaw: getSystemSettingsRaw,
  write: (key, value) => setSystemSetting(key, value),
  remove: deleteSystemSetting,
  lookup: lookupBitwardenSecret,
})

export const getSecretBindings = bindings.list
export const isCredentialLinked = bindings.isLinked
export const bindSecret = bindings.bind
export const unbindSecret = bindings.unbind
