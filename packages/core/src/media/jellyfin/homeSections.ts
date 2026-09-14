/**
 * Jellyfin has no equivalent of Emby's ContentService, so managed home sections
 * are an Emby-only feature. These exist to keep the two providers' method sets
 * equal (the mirroring invariant); the sync checks `provider.type` before it
 * calls any of them, so reaching one is a bug in the caller.
 */

import type { ContentSection, MediaServerTag } from '../types.js'
import type { JellyfinProviderBase } from './base.js'

function unsupported(operation: string): Error {
  return new Error(`Managed home sections are not supported on Jellyfin (${operation})`)
}

export async function getHomeSections(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _userId: string
): Promise<ContentSection[]> {
  throw unsupported('getHomeSections')
}

export async function saveHomeSection(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _userId: string,
  _section: ContentSection
): Promise<void> {
  throw unsupported('saveHomeSection')
}

export async function deleteHomeSections(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _userId: string,
  _sectionIds: string[]
): Promise<void> {
  throw unsupported('deleteHomeSections')
}

export async function moveHomeSections(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _userId: string,
  _sectionIds: string[],
  _newIndex: number
): Promise<void> {
  throw unsupported('moveHomeSections')
}

export async function getTagsByPrefix(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _prefix: string
): Promise<MediaServerTag[]> {
  throw unsupported('getTagsByPrefix')
}

export async function getItemIdsWithTag(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _tagName: string
): Promise<string[]> {
  throw unsupported('getItemIdsWithTag')
}

export async function addItemTag(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _itemId: string,
  _tag: MediaServerTag
): Promise<void> {
  throw unsupported('addItemTag')
}

export async function removeItemTag(
  _provider: JellyfinProviderBase,
  _apiKey: string,
  _itemId: string,
  _tag: MediaServerTag
): Promise<void> {
  throw unsupported('removeItemTag')
}
