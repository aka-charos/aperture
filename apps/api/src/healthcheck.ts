/**
 * The image's HEALTHCHECK: exit 0 when this container's server answers /health
 * with a success, 1 otherwise. What goes to stderr is what the container
 * runtime's health log shows.
 *
 * Its own process, so it loads nothing but the address logic. Docker's limit on
 * the check is 10 seconds; this gives up first so the log says why.
 */
import { get } from 'node:http'
import { probeUrl } from './config/healthProbe.js'

const TIMEOUT_MS = 8000

const url = probeUrl()

function fail(reason: string): never {
  console.error(`${url}: ${reason}`)
  process.exit(1)
}

const request = get(url, { timeout: TIMEOUT_MS }, (response) => {
  response.resume()
  const status = response.statusCode ?? 0
  if (status >= 200 && status < 300) process.exit(0)
  fail(`answered ${status}`)
})

request.on('timeout', () => fail(`no answer within ${TIMEOUT_MS} ms`))
request.on('error', (err) => fail(err.message))
