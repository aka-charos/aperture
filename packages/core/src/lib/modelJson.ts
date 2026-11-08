/**
 * Reading JSON a language model wrote by hand (no structured-output mode).
 *
 * Models, Ollama's local ones especially, escape an apostrophe the way a
 * JavaScript string would: `"don\'t"`. `\'` is not a JSON escape, so one
 * apostrophe makes `JSON.parse` refuse the whole document, and with it every
 * other entry the model wrote correctly. A stray backslash before any other
 * letter (`C:\d`) fails the same way.
 *
 * `parseModelJson` parses strictly first, and only when that fails retries on a
 * copy with those escapes repaired inside string bodies. Valid JSON is never
 * touched, and the repair changes nothing outside a string. A document that is
 * still unreadable after repair (cut off, or a quote left unescaped inside the
 * prose) throws as `JSON.parse` does, so each caller keeps its own fallback.
 */

/** The characters that may follow a backslash in JSON. */
const JSON_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/**
 * Rewrite the invalid escapes inside string bodies: `\'` becomes `'`, and any
 * other non-escape keeps its backslash as a literal one (`\d` → `\\d`, which
 * reads back as `\d`), so no character the model wrote is lost. A valid escape
 * is copied as is, which keeps an escaped backslash followed by an apostrophe
 * (`\\'`) a backslash and an apostrophe.
 */
export function repairModelJsonEscapes(text: string): string {
  let out = ''
  let inString = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (!inString) {
      out += char
      if (char === '"') inString = true
      continue
    }

    if (char === '"') {
      out += char
      inString = false
      continue
    }

    if (char !== '\\') {
      out += char
      continue
    }

    const next = text[i + 1]
    // A backslash ending the text: cut off mid-escape, nothing to repair.
    if (next === undefined) {
      out += char
      break
    }

    i++
    if (next === "'") out += "'"
    else if (JSON_ESCAPE_CHARS.has(next)) out += char + next
    else out += '\\\\' + next
  }

  return out
}

/** `JSON.parse`, retried once on the repaired text. Throws when both fail. */
export function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const repaired = repairModelJsonEscapes(text)
    if (repaired === text) throw error
    return JSON.parse(repaired)
  }
}
