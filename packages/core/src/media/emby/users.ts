/**
 * Emby Users Module
 */

import type { MediaServerUser } from '../types.js'
import type { EmbyUser } from './types.js'
import type { EmbyProviderBase } from './base.js'
import { isEmailAddress } from '../../email/rules.js'

/**
 * Whether an Emby Connect name can be stored as the user's address: the test
 * the mail transport applies, plus a dotted domain, since a Connect name is
 * an Emby account id and `user@localhost` there is not a mailbox.
 */
function isValidEmail(str: string | undefined): boolean {
  return isEmailAddress(str) && str.slice(str.lastIndexOf('@') + 1).includes('.')
}

export async function getUsers(
  provider: EmbyProviderBase,
  apiKey: string
): Promise<MediaServerUser[]> {
  const users = await provider.fetch<EmbyUser[]>('/Users', apiKey)

  return users.map((user) => ({
    id: user.Id,
    name: user.Name,
    serverId: user.ServerId,
    isAdmin: user.Policy.IsAdministrator,
    isDisabled: user.Policy.IsDisabled,
    lastActivityDate: user.LastActivityDate,
    primaryImageTag: user.PrimaryImageTag,
    maxParentalRating: user.Policy.MaxParentalRating,
    // Absent EnableAllFolders is the server default, which is every folder.
    folderAccess: {
      enableAllFolders: user.Policy.EnableAllFolders ?? true,
      enabledFolders: user.Policy.EnabledFolders ?? [],
    },
    // ConnectUserName is the Emby Connect username - only use if it looks like an email
    // Note: Emby does NOT expose actual email addresses via API for privacy reasons
    email: isValidEmail(user.ConnectUserName) ? user.ConnectUserName : undefined,
  }))
}

export async function getUserById(
  provider: EmbyProviderBase,
  apiKey: string,
  userId: string
): Promise<MediaServerUser> {
  const user = await provider.fetch<EmbyUser>(`/Users/${userId}`, apiKey)

  return {
    id: user.Id,
    name: user.Name,
    serverId: user.ServerId,
    isAdmin: user.Policy.IsAdministrator,
    isDisabled: user.Policy.IsDisabled,
    lastActivityDate: user.LastActivityDate,
    primaryImageTag: user.PrimaryImageTag,
    maxParentalRating: user.Policy.MaxParentalRating,
    // Absent EnableAllFolders is the server default, which is every folder.
    folderAccess: {
      enableAllFolders: user.Policy.EnableAllFolders ?? true,
      enabledFolders: user.Policy.EnabledFolders ?? [],
    },
    // Only use ConnectUserName if it looks like an email
    email: isValidEmail(user.ConnectUserName) ? user.ConnectUserName : undefined,
  }
}



