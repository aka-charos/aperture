/** A scan date the way the rest of the page writes dates: "28 Sept 2026", in the reader's language. */
export function formatScanDate(iso: string, language: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
}
