export type DownloadResult = { ok: true } | { ok: false; message: string | null }

/**
 * Fetches a file and saves it, so a refusal or a dropped connection comes back
 * for the page to show. A plain download link can't do that: the browser takes
 * the response and the page never hears how it went.
 *
 * `message` is the server's sentence when it sent one; null leaves the wording
 * to the caller.
 */
export async function downloadToFile(url: string, fileName: string): Promise<DownloadResult> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      return { ok: false, message: json?.error ?? null }
    }
    const objectUrl = URL.createObjectURL(await res.blob())
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = fileName
    link.click()
    URL.revokeObjectURL(objectUrl)
    return { ok: true }
  } catch {
    return { ok: false, message: null }
  }
}
