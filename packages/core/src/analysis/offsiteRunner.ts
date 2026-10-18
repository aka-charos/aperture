/**
 * The script that runs an offsite batch on another machine (./offsite.ts).
 *
 * Kept as a string in core rather than as a file beside the API because the
 * Docker image ships compiled dists and `db/` only — a loose `.mjs` would not
 * be in it, and the admin page serves this for download so the other machine
 * needs nothing from the repo. `offsiteRunner.test.ts` writes it to disk and
 * runs it against a fake server, so it is tested as the file a person gets.
 *
 * WRITTEN WITHOUT BACKTICKS OR TEMPLATE HOLES so it can sit inside
 * `String.raw` unchanged: a `${` in the script would be evaluated here, at
 * module load, and a backtick would end the string. The test checks both.
 *
 * What it does is documented in its own header and in docs/admin/
 * offsite-analysis.md. The one non-obvious choice: it streams every request
 * through node:http, not fetch, because fetch abandons a request that has sent
 * no headers for five minutes, and a slow model reading a 20k-token prompt can
 * take that long before its first token (F-115's wall, on the other machine).
 */

/** The name the download is saved under. */
export const OFFSITE_RUNNER_FILE_NAME = 'run-offsite-analysis.mjs'

export const OFFSITE_RUNNER_SCRIPT = String.raw`#!/usr/bin/env node
// Aperture offsite analysis runner.
//
// Sends each prompt in an Aperture batch file to an OpenAI-compatible server
// (LM Studio by default) and writes the answers to a results file, which you
// then upload in Aperture: Admin > AI > Offsite analysis.
//
// Needs Node 18 or newer and nothing else. Every answer is written the moment
// it finishes, and a rerun skips titles the results file already answers, so
// it can be stopped and resumed at any time.
//
// Requests are streamed on purpose: a non-streamed answer sends nothing until
// it is finished, and Node gives up on a silent request after five minutes.

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const FORMAT = 'aperture-analysis-offsite/1'
const MAX_CONSECUTIVE_ERRORS = 5

const USAGE = [
  'Usage: node run-offsite-analysis.mjs <batch.jsonl> --model <model id> [options]',
  '',
  'Options:',
  '  --model <id>           Model to use, as the server lists it. Leave it out to see the list.',
  '  --out <file>           Results file (default: <batch>.results.jsonl next to the batch).',
  '  --base-url <url>       Server address (default: http://localhost:1234/v1, LM Studio).',
  '  --api-key <key>        Sent as a Bearer token, for servers that need one.',
  '  --concurrency <n>      Requests at a time (default: 1).',
  '  --limit <n>            Only run the first n unanswered titles, for a test.',
  '  --stall-seconds <n>    Give up on a request after this long with no data (default: 600).',
  '  --max-tokens <n|none>  Override the batch\'s output ceiling.',
  '  --temperature <n|none> Override the batch\'s temperature.',
  '  --help                 Show this.',
].join('\n')

function fail(message) {
  console.error('Error: ' + message)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    batch: null,
    model: null,
    out: null,
    baseUrl: 'http://localhost:1234/v1',
    apiKey: null,
    concurrency: 1,
    limit: null,
    stallSeconds: 600,
    maxTokens: undefined,
    temperature: undefined,
  }
  const takesValue = new Set([
    '--model', '--out', '--base-url', '--api-key', '--concurrency', '--limit',
    '--stall-seconds', '--max-tokens', '--temperature',
  ])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (takesValue.has(arg)) {
      const value = argv[++i]
      if (value === undefined) fail(arg + ' needs a value.\n\n' + USAGE)
      switch (arg) {
        case '--model': opts.model = value; break
        case '--out': opts.out = value; break
        case '--base-url': opts.baseUrl = value.replace(/\/+$/, ''); break
        case '--api-key': opts.apiKey = value; break
        case '--concurrency': opts.concurrency = positiveInt(arg, value); break
        case '--limit': opts.limit = positiveInt(arg, value); break
        case '--stall-seconds': opts.stallSeconds = positiveInt(arg, value); break
        case '--max-tokens': opts.maxTokens = value === 'none' ? null : positiveInt(arg, value); break
        case '--temperature': opts.temperature = value === 'none' ? null : number(arg, value); break
      }
      continue
    }
    if (arg.startsWith('--')) fail('Unknown option ' + arg + '.\n\n' + USAGE)
    if (opts.batch) fail('Only one batch file at a time.')
    opts.batch = arg
  }
  if (!opts.batch) fail('Name the batch file.\n\n' + USAGE)
  if (!opts.out) {
    const parsed = path.parse(opts.batch)
    opts.out = path.join(parsed.dir, parsed.name + '.results.jsonl')
  }
  return opts
}

function positiveInt(flag, value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) fail(flag + ' must be a whole number above 0.')
  return n
}

function number(flag, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) fail(flag + ' must be a number, or none.')
  return n
}

function readBatch(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    fail('Could not read ' + file + ': ' + err.message)
  }
  const items = []
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    let row
    try {
      row = JSON.parse(line)
    } catch {
      fail('Line ' + (index + 1) + ' of ' + file + ' is not JSON. Is this an Aperture batch file?')
    }
    if (row.format !== FORMAT) {
      fail('Line ' + (index + 1) + ' is not an Aperture batch line (format ' + row.format + '). ' +
        'This runner reads ' + FORMAT + '; download the runner again from Aperture.')
    }
    if (typeof row.custom_id !== 'string' || typeof row.prompt !== 'string') {
      fail('Line ' + (index + 1) + ' has no custom_id or prompt.')
    }
    items.push(row)
  })
  return items
}

// Titles already answered. An error line does not count: a rerun tries it again.
function readAnswered(file) {
  const done = new Set()
  if (!fs.existsSync(file)) return done
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (typeof row.custom_id === 'string' && typeof row.text === 'string') done.add(row.custom_id)
    } catch {
      // A half-written last line from a killed run. Its title is simply run again.
    }
  }
  return done
}

function request(opts, method, pathname, body, onResponse) {
  const url = new URL(opts.baseUrl + pathname)
  const lib = url.protocol === 'https:' ? https : http
  const headers = { Accept: 'application/json, text/event-stream' }
  let payload = null
  if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body), 'utf8')
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = String(payload.length)
  }
  if (opts.apiKey) headers.Authorization = 'Bearer ' + opts.apiKey
  // node:http rather than fetch: fetch gives up after five minutes without
  // response headers, which a slow model processing a long prompt can take.
  const req = lib.request(url, { method, headers }, onResponse)
  if (payload) req.write(payload)
  req.end()
  return req
}

function readWhole(res) {
  return new Promise((resolve, reject) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    res.on('error', reject)
  })
}

async function listModels(opts) {
  return new Promise((resolve, reject) => {
    const req = request(opts, 'GET', '/models', undefined, async (res) => {
      try {
        const text = await readWhole(res)
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode + ' from ' + opts.baseUrl + '/models: ' + text.slice(0, 200)))
          return
        }
        const data = JSON.parse(text)
        resolve(Array.isArray(data.data) ? data.data.map((m) => m.id).filter(Boolean) : [])
      } catch (err) {
        reject(err)
      }
    })
    req.setTimeout(15000, () => req.destroy(new Error('No answer within 15s')))
    req.on('error', reject)
  })
}

function errorText(text) {
  try {
    const data = JSON.parse(text)
    const e = data.error
    if (typeof e === 'string') return e
    if (e && typeof e.message === 'string') return e.message
  } catch {
    // not JSON
  }
  return text.slice(0, 300)
}

// One prompt, streamed. Resolves with the answer, rejects with a reason.
function complete(opts, item, onProgress) {
  const body = {
    model: opts.model,
    messages: [{ role: 'user', content: item.prompt }],
    stream: true,
    stream_options: { include_usage: true },
  }
  const maxTokens = opts.maxTokens !== undefined ? opts.maxTokens : item.max_tokens
  const temperature = opts.temperature !== undefined ? opts.temperature : item.temperature
  if (maxTokens != null) body.max_tokens = maxTokens
  if (temperature != null) body.temperature = temperature
  if (opts.temperature === undefined && item.top_p != null) body.top_p = item.top_p

  return new Promise((resolve, reject) => {
    let settled = false
    let text = ''
    let reasoningChars = 0
    let finishReason = null
    let usage = null
    let model = null
    let deltas = 0
    let stallTimer = null

    const done = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(stallTimer)
      if (err) reject(err)
      else resolve(value)
    }
    const armStall = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        req.destroy(new Error('No data for ' + opts.stallSeconds + 's; the server seems stuck'))
      }, opts.stallSeconds * 1000)
    }

    const req = request(opts, 'POST', '/chat/completions', body, async (res) => {
      armStall()
      if (res.statusCode !== 200) {
        const textBody = await readWhole(res).catch(() => '')
        done(new Error('HTTP ' + res.statusCode + ': ' + errorText(textBody)))
        return
      }

      // A server that ignored 'stream' answers with one JSON document.
      const type = String(res.headers['content-type'] || '')
      if (!type.includes('text/event-stream')) {
        try {
          const data = JSON.parse(await readWhole(res))
          const choice = (data.choices || [])[0] || {}
          const content = choice.message && typeof choice.message.content === 'string' ? choice.message.content : null
          if (content == null) throw new Error('The server answered with no message content')
          done(null, { text: content, finishReason: choice.finish_reason || null, usage: data.usage || null, model: data.model || null })
        } catch (err) {
          done(err)
        }
        return
      }

      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        armStall()
        buffer += chunk
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let event
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }
          if (event.error) {
            done(new Error(typeof event.error === 'string' ? event.error : event.error.message || 'Server error'))
            req.destroy()
            return
          }
          if (event.model) model = event.model
          if (event.usage) usage = event.usage
          const choice = (event.choices || [])[0]
          if (!choice) continue
          const delta = choice.delta || {}
          if (typeof delta.content === 'string' && delta.content) {
            text += delta.content
            deltas++
          }
          const reasoning = delta.reasoning_content || delta.reasoning
          if (typeof reasoning === 'string') reasoningChars += reasoning.length
          if (choice.finish_reason) finishReason = choice.finish_reason
          onProgress({ deltas, reasoningChars })
        }
      })
      res.on('end', () => {
        if (finishReason == null) {
          done(new Error('The stream ended before the answer finished'))
          return
        }
        done(null, { text, finishReason, usage, model })
      })
      res.on('error', (err) => done(err))
    })
    req.on('error', (err) => done(err))
    armStall()
  })
}

function label(item) {
  return item.year ? item.title + ' (' + item.year + ')' : item.title
}

function seconds(ms) {
  return (ms / 1000).toFixed(0) + 's'
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const items = readBatch(opts.batch)
  if (items.length === 0) fail('The batch file holds no titles.')

  let models
  try {
    models = await listModels(opts)
  } catch (err) {
    fail('Could not reach ' + opts.baseUrl + ' (' + err.message + ').\n' +
      'Is the server running? In LM Studio: Developer tab > Start server.')
  }
  if (!opts.model) {
    console.log('Pick a model with --model. The server lists:')
    for (const id of models) console.log('  ' + id)
    if (models.length === 0) console.log('  (none loaded; LM Studio loads a model on first use if you name it)')
    process.exit(1)
  }
  if (models.length > 0 && !models.includes(opts.model)) {
    console.warn('Warning: ' + opts.model + ' is not in the server\'s list (' + models.join(', ') + '). Trying anyway.')
  }

  const answered = readAnswered(opts.out)
  let queue = items.filter((item) => !answered.has(item.custom_id))
  if (opts.limit) queue = queue.slice(0, opts.limit)

  console.log('Batch: ' + items.length + ' title(s), ' + answered.size + ' already answered in ' + opts.out)
  console.log('Running ' + queue.length + ' with ' + opts.model + ' at ' + opts.baseUrl +
    (opts.concurrency > 1 ? ', ' + opts.concurrency + ' at a time' : ''))
  const first = items[0]
  console.log('Prompt v' + first.prompt_version + (first.prompt_variant ? ' ' + first.prompt_variant : '') +
    ', output ceiling ' + (first.max_tokens == null ? 'none' : first.max_tokens) + ' tokens')
  console.log('A prompt is about 20,000 tokens, so load the model with a context of at least 32k.')
  console.log('')

  if (queue.length === 0) {
    console.log('Nothing left to run. Upload ' + opts.out + ' in Aperture: Admin > AI > Offsite analysis.')
    return
  }

  process.on('SIGINT', () => {
    console.log('\nStopped. Titles already finished are saved; run the same command again to resume.')
    process.exit(130)
  })

  const live = opts.concurrency === 1 && process.stdout.isTTY
  const total = queue.length
  let next = 0
  let finished = 0
  let succeeded = 0
  let errors = 0
  let consecutiveErrors = 0
  let stopping = false
  const startedAll = Date.now()

  async function worker() {
    while (!stopping && next < queue.length) {
      const item = queue[next++]
      const n = next
      const started = Date.now()
      let lastDraw = 0
      if (!live) console.log('[' + n + '/' + total + '] ' + label(item) + ' ...')
      try {
        const answer = await complete(opts, item, (p) => {
          if (!live) return
          const now = Date.now()
          if (now - lastDraw < 250) return
          lastDraw = now
          const thinking = p.reasoningChars > 0 && p.deltas === 0 ? ' thinking' : ''
          process.stdout.write('\r[' + n + '/' + total + '] ' + label(item) + ' ... ' +
            p.deltas + ' tokens' + thinking + ', ' + seconds(Date.now() - started) + '   ')
        })
        const ms = Date.now() - started
        fs.appendFileSync(opts.out, JSON.stringify({
          custom_id: item.custom_id,
          title: item.title,
          model: answer.model || opts.model,
          text: answer.text,
          finish_reason: answer.finishReason,
          usage: answer.usage,
          elapsed_ms: ms,
        }) + '\n')
        const tokens = answer.usage && answer.usage.completion_tokens
        const rate = tokens ? ', ' + (tokens / (ms / 1000)).toFixed(1) + ' tok/s' : ''
        const cut = answer.finishReason === 'length' ? ' (hit the output ceiling)' : ''
        if (live) process.stdout.write('\r')
        console.log('[' + n + '/' + total + '] done   ' + label(item) + ' - ' +
          (tokens ? tokens + ' tokens in ' : '') + seconds(ms) + rate + cut + '          ')
        succeeded++
        consecutiveErrors = 0
      } catch (err) {
        const reason = err && err.message ? err.message : String(err)
        fs.appendFileSync(opts.out, JSON.stringify({
          custom_id: item.custom_id,
          title: item.title,
          model: opts.model,
          error: reason,
        }) + '\n')
        if (live) process.stdout.write('\r')
        console.log('[' + n + '/' + total + '] FAILED ' + label(item) + ' - ' + reason + '          ')
        errors++
        consecutiveErrors++
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !stopping) {
          stopping = true
          console.log('\nStopping after ' + consecutiveErrors + ' failures in a row: that is the server, not the titles.')
          console.log('Check LM Studio, then run the same command again to resume.')
        }
      }
      finished++
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, queue.length) }, () => worker()))

  console.log('')
  console.log('Finished ' + finished + ' of ' + total + ' in ' + seconds(Date.now() - startedAll) +
    ': ' + succeeded + ' answered, ' + errors + ' failed.')
  if (errors > 0) console.log('Failed titles are retried when you run the same command again.')
  console.log('Upload ' + opts.out + ' in Aperture: Admin > AI > Offsite analysis.')
  if (stopping) process.exit(1)
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)))
`
