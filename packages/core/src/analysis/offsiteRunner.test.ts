/**
 * The runner, tested as the file a person downloads: written to a temp folder
 * and run with this Node against a fake OpenAI-compatible server.
 *
 * Every test carries a time limit and closes its server, because the faults
 * this guards against (a stall guard that never fires, a stream never read to
 * its end) HANG rather than fail.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

import { OFFSITE_RUNNER_FILE_NAME, OFFSITE_RUNNER_SCRIPT } from './offsiteRunner.js'
import { OFFSITE_FORMAT, buildExportFile, parseOffsiteResults } from './offsiteFormat.js'

interface Seen {
  body: Record<string, unknown>
}

/** A fake LM Studio. The prompt text picks the behaviour. */
function fakeServer(seen: Seen[]) {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      seen.push({ body })
      const prompt = ((body.messages as { content: string }[])[0]).content
      if (prompt.includes('FAIL')) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'model crashed' } }))
        return
      }
      if (prompt.includes('STALL')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(': keep\n\n')
        return // never another byte
      }
      if (prompt.includes('PLAINJSON')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            model: 'test-model',
            choices: [{ message: { content: 'whole answer' }, finish_reason: 'stop' }],
          })
        )
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (event: unknown) => res.write('data: ' + JSON.stringify(event) + '\n\n')
      send({ model: 'test-model', choices: [{ delta: { reasoning_content: 'hmm' } }] })
      send({ choices: [{ delta: { content: '<think>x</think>Answer for ' } }] })
      // A chunk boundary inside an event, which a line reader must survive.
      const tail = 'data: ' + JSON.stringify({ choices: [{ delta: { content: prompt } }] }) + '\n\n'
      res.write(tail.slice(0, 10))
      setTimeout(() => {
        res.write(tail.slice(10))
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
        send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 7 } })
        res.write('data: [DONE]\n\n')
        res.end()
      }, 20)
    })
  })
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: 'http://127.0.0.1:' + port + '/v1' })
    })
  })
}

function workdir(prompts: string[], maxTokens: number | null = 8000, attempt = 0, labels?: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-runner-'))
  const script = path.join(dir, OFFSITE_RUNNER_FILE_NAME)
  fs.writeFileSync(script, OFFSITE_RUNNER_SCRIPT)
  const batch = path.join(dir, 'batch.jsonl')
  fs.writeFileSync(
    batch,
    buildExportFile(
      prompts.map((prompt, i) => ({
        id: 'id-' + i,
        mediaType: 'movie',
        title: 'T' + i,
        year: 2000 + i,
        attempt,
        prompt,
        label: labels?.[i],
      })),
      { promptVersion: 18, promptVariant: null, maxOutputTokens: maxTokens }
    )
  )
  return { dir, script, batch, out: path.join(dir, 'batch.results.jsonl') }
}

function run(script: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], { timeout: 20000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

test('the script is a file a person can run: shebang first, and the format it reads is the one exported', () => {
  assert.ok(OFFSITE_RUNNER_SCRIPT.startsWith('#!/usr/bin/env node\n'))
  // Drift guard: the runner refuses lines whose format it does not know, so a
  // renamed format in one place and not the other would refuse every batch.
  assert.ok(OFFSITE_RUNNER_SCRIPT.includes("const FORMAT = '" + OFFSITE_FORMAT + "'"))
})

test('runs a batch: streamed answers and failures land in a results file the import can read', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['first prompt', 'FAIL please', 'PLAINJSON here'])
    const result = await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(result.code, 0, result.stderr + result.stdout)

    // What was sent: the batch's ceiling, streamed, as one user message, and no
    // sampling settings (a local model in Aperture is sent none).
    assert.equal(seen.length, 3)
    assert.equal(seen[0].body.stream, true)
    assert.equal(seen[0].body.model, 'test-model')
    assert.equal(seen[0].body.max_tokens, 8000)
    assert.equal('temperature' in seen[0].body, false)
    assert.equal('top_p' in seen[0].body, false)

    const parsed = parseOffsiteResults(fs.readFileSync(w.out, 'utf8'))
    assert.deepEqual(parsed.badLines, [])
    const byId = new Map(parsed.results.map((r) => [r.customId, r]))

    const first = byId.get('id-0')
    assert.equal(first?.kind, 'answer')
    if (first?.kind === 'answer') {
      // RAW: the think block stays for the import to strip; reasoning_content is not text.
      assert.equal(first.text, '<think>x</think>Answer for first prompt')
      assert.equal(first.finishReason, 'stop')
      assert.equal(first.outputTokens, 7)
      assert.equal(first.model, 'test-model')
    }
    const failed = byId.get('id-1')
    assert.equal(failed?.kind, 'error')
    assert.match(failed?.kind === 'error' ? failed.error : '', /HTTP 500: model crashed/)
    const plain = byId.get('id-2')
    assert.equal(plain?.kind === 'answer' && plain.text, 'whole answer')
  } finally {
    server.close()
  }
})

test('a rerun sends only what is unanswered: the failure again, never an answered title', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['one', 'FAIL', 'two'])
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    seen.length = 0
    const again = await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(again.code, 0)
    assert.equal(seen.length, 1)
    assert.match(((seen[0].body.messages as { content: string }[])[0]).content, /FAIL/)
  } finally {
    server.close()
  }
})

test('--limit runs a few for a test, and --max-tokens none sends no ceiling', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['a', 'b', 'c'])
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl, '--limit', '1', '--max-tokens', 'none'])
    assert.equal(seen.length, 1)
    assert.equal('max_tokens' in seen[0].body, false)
  } finally {
    server.close()
  }
})

test('a server that goes silent is given up on after the stall window, not waited on forever', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['STALL'])
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl, '--stall-seconds', '1'])
    const [r] = parseOffsiteResults(fs.readFileSync(w.out, 'utf8')).results
    assert.equal(r.kind, 'error')
    assert.match(r.kind === 'error' ? r.error : '', /No data for 1s/)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('without --model it lists what the server has and sends nothing', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['a'])
    const result = await run(w.script, [w.batch, '--base-url', baseUrl])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /test-model/)
    assert.equal(seen.length, 0)
  } finally {
    server.close()
  }
})

test('an unreachable server is named as such, with what to check', { timeout: 30000 }, async () => {
  const w = workdir(['a'])
  const result = await run(w.script, [w.batch, '--model', 'm', '--base-url', 'http://127.0.0.1:1/v1'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Could not reach/)
  assert.match(result.stderr, /Start server/)
})

test('a title the import rejected runs again: the new batch carries the next attempt', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    // First pass answers attempt 0.
    const w = workdir(['only title'])
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(seen.length, 1)
    const first = parseOffsiteResults(fs.readFileSync(w.out, 'utf8')).results[0]
    assert.equal(first.attempt, 0)

    // Aperture rejected it, so the re-downloaded batch carries attempt 1. The
    // same command, same results file, must send it again rather than skip it.
    const again = workdir(['only title'], 8000, 1)
    fs.copyFileSync(again.batch, w.batch)
    seen.length = 0
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(seen.length, 1)
    const latest = parseOffsiteResults(fs.readFileSync(w.out, 'utf8')).results[0]
    assert.equal(latest.attempt, 1)
  } finally {
    server.close()
  }
})

/**
 * A BENCH FILE IS SEVERAL MODELS' WORK, AND EACH LINE SAYS WHOSE.
 *
 * Its prompts are usually byte-identical (one retrieval, one prompt version,
 * one line per model), so before lines carried a label the runner sent all of
 * them to the one --model it was given and a three-model bench came back as
 * one model answering three times - with nothing anywhere saying so.
 */
test('a bench file with several models is refused without --label, and nothing is sent', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['same prompt', 'same prompt'], 8000, 0, ['qwen', 'polystrata / big model'])
    const result = await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(result.code, 1)
    assert.equal(seen.length, 0)
    // Both models named, each with a command that runs it; a label with a
    // space is quoted so the command can be pasted as it stands.
    assert.match(result.stderr, /--label qwen --model/)
    assert.match(result.stderr, /--label "polystrata \/ big model" --model/)
  } finally {
    server.close()
  }
})

test('--label runs one model\'s lines, and a run per model fills one results file', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['p0', 'p1', 'p2'], 8000, 0, ['alpha', 'beta', 'alpha'])
    const first = await run(w.script, [w.batch, '--label', 'alpha', '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(first.code, 0, first.stderr + first.stdout)
    assert.equal(seen.length, 2)
    assert.match(first.stdout, /Other models in this file.*beta/)

    seen.length = 0
    const second = await run(w.script, [w.batch, '--label', 'beta', '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(second.code, 0, second.stderr + second.stdout)
    assert.equal(seen.length, 1, 'only beta\'s line; alpha\'s are neither answered again nor sent to beta')
    assert.match(((seen[0].body.messages as { content: string }[])[0]).content, /p1/)

    const ids = parseOffsiteResults(fs.readFileSync(w.out, 'utf8')).results.map((r) => r.customId).sort()
    assert.deepEqual(ids, ['id-0', 'id-1', 'id-2'])
  } finally {
    server.close()
  }
})

test('a --model that is exactly one of the labels picks that model\'s lines', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['p0', 'p1'], 8000, 0, ['test-model', 'other'])
    const result = await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(result.code, 0, result.stderr + result.stdout)
    assert.equal(seen.length, 1)
    assert.match(((seen[0].body.messages as { content: string }[])[0]).content, /p0/)
  } finally {
    server.close()
  }
})

test('a label no line carries, or --label on an offsite batch, is refused', { timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const bench = workdir(['p0', 'p1'], 8000, 0, ['alpha', 'beta'])
    const wrong = await run(bench.script, [bench.batch, '--label', 'gamma', '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(wrong.code, 1)
    assert.match(wrong.stderr, /No line in this file is for "gamma"/)

    const offsite = workdir(['p0'])
    const stray = await run(offsite.script, [offsite.batch, '--label', 'alpha', '--model', 'test-model', '--base-url', baseUrl])
    assert.equal(stray.code, 1)
    assert.match(stray.stderr, /name no models/)
    assert.equal(seen.length, 0)
  } finally {
    server.close()
  }
})

test('--temperature is sent only when asked for',{ timeout: 30000 }, async () => {
  const seen: Seen[] = []
  const { server, baseUrl } = await fakeServer(seen)
  try {
    const w = workdir(['a'])
    await run(w.script, [w.batch, '--model', 'test-model', '--base-url', baseUrl, '--temperature', '0.4'])
    assert.equal(seen[0].body.temperature, 0.4)
  } finally {
    server.close()
  }
})
