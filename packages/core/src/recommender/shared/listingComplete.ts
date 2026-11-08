/**
 * May a library sync delete what the media server's listing did not mention?
 *
 * Only when the listing is known to be whole. The syncs page through results in
 * an order the server does not promise is stable, and a scan running at the same
 * time can move an item across a page boundary: one item is then read twice and
 * another not at all. The number of rows still matches the server's total, so
 * comparing that alone called the listing complete, and the item it skipped was
 * deleted, with its ratings and history following by cascade.
 *
 * Pure, and shared by the movie, series and episode cleanups.
 */
export function listingIsComplete(listing: {
  expected: number
  fetched: number
  distinct: number
}): boolean {
  return listing.fetched === listing.expected && listing.distinct === listing.expected
}
