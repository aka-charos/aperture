import { useContext } from 'react'
import { UserHelpContext, type UserHelpContextValue } from './user-help-context'

const NO_HELP: UserHelpContextValue = { openHelp: () => {}, isOpen: false }

/**
 * Open the user guide drawer. Outside Layout (the login page, the guide
 * itself) there is no drawer, and asking for one does nothing.
 */
export function useUserHelp(): UserHelpContextValue {
  return useContext(UserHelpContext) ?? NO_HELP
}
