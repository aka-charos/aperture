/**
 * The runner commands the bench's by-hand panel prints. Pure and pinned: a
 * model's name is free text the operator typed, so a wrong quote here hands them
 * a command that answers nothing.
 */

/** The prompts file's name; the panel's command has to name what was downloaded. */
export const benchFileName = (runId: string) => `bench-${runId}.jsonl`

/** Same rule as the runner's own `quoteArg`, whose refusals print these commands too. */
export const quoteRunnerArg = (value: string) =>
  /^[A-Za-z0-9._:/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`

/**
 * Who still owes an answer, in the run's order. An answered model has no lines
 * left in a fresh download, and the runner refuses a `--label` it cannot find.
 * One model appears once however many prompt versions it answers.
 */
export function outstandingLabels(entries: { model: string; status: string }[]): string[] {
  const labels = entries.filter((entry) => entry.status === 'pending').map((entry) => entry.model)
  return [...new Set(labels)]
}

/** One command per model, each picking its own lines out of the shared file. */
export const benchRunCommands = (runnerFileName: string, runId: string, labels: string[]) =>
  labels.map(
    (label) =>
      `node ${runnerFileName} ${benchFileName(runId)} --label ${quoteRunnerArg(label)} --model <model id>`
  )
