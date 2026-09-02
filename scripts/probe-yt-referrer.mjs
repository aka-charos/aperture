/**
 * Does the missing Referer header cause YouTube Error 153?
 *
 * THE QUESTION. Trailers render as YouTube's own "Video player configuration
 * error / Error 153" panel in all four places `TrailerModal` is mounted.
 * Everything a reader reaches for first is innocent: the frame is not blocked
 * (the error page is served BY YouTube, inside the frame), the embed URL is
 * validated by `youtubeWatchUrlToEmbedUrl`, and `frameSrc` already names
 * youtube.com. The suspect is nowhere near the component -- `helmetOptions()`
 * in `apps/api/src/config/security.ts` sends `Referrer-Policy: no-referrer` on
 * every response, and the YouTube player refuses to build a configuration for
 * an embed it cannot attribute to a site.
 *
 * WHY THIS SERVES A PAGE RATHER THAN CURLING SOMETHING. The refusal happens
 * inside the player's own JS after the frame document loads, so there is no
 * status code and no response body to read -- the only instrument is a real
 * browser rendering a real embed under the real headers. Hence a server that
 * reproduces Aperture's exact `Referrer-Policy` and CSP, and one iframe whose
 * only variable is the attribute under test.
 *
 * WHY ONE FRAME PER PAGE, NOT TWO SIDE BY SIDE. Two embeds on one page share a
 * player-config fetch and a set of cookies, so a pass on the second can be the
 * first one's cache. Load the two URLs separately.
 *
 * RUN:  node scripts/probe-yt-referrer.mjs
 * THEN: open http://localhost:4599/?policy=none    -- expect Error 153
 *       open http://localhost:4599/?policy=strict  -- expect the video to play
 *
 * MEASURED 2026-09-03 (Chrome): none -> Error 153, pixel-identical to the bug
 * report; strict -> plays. Same document, header, CSP, video id and session, so
 * the iframe attribute is the whole difference. See F-101.
 */
import { createServer } from 'node:http'

const PORT = 4599
// Public, embeddable, and unmistakable when it plays.
const VIDEO = process.env.PROBE_VIDEO_ID || 'dQw4w9WgXcQ'
const src = `https://www.youtube.com/embed/${VIDEO}?autoplay=1&mute=1&rel=0`

// Copied from helmetOptions() rather than imported: the point is to reproduce
// what the browser receives, and importing would let a later edit to the app
// silently change what this probe is testing.
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; " +
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; " +
  "frame-ancestors 'none'; object-src 'none'"

createServer((req, res) => {
  const strict = /policy=strict/.test(req.url || '')
  const attr = strict ? ' referrerpolicy="strict-origin-when-cross-origin"' : ''
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>probe ${strict ? 'strict' : 'none'}</title>
<style>html,body{margin:0;background:#111}iframe{width:100vw;height:100vh;display:block;border:0;background:#000}</style>
</head><body>
<iframe src="${src}"${attr} allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
</body></html>`)
}).listen(PORT, () => {
  console.log(`probe listening on http://localhost:${PORT}`)
  console.log(`  http://localhost:${PORT}/?policy=none    (inherits Referrer-Policy: no-referrer)`)
  console.log(`  http://localhost:${PORT}/?policy=strict  (iframe overrides it)`)
})
