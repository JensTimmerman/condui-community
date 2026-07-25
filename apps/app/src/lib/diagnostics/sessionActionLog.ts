/**
 * In-memory ring buffer of coarse-grained session actions for diagnostic submissions
 * (e.g. orphan auto-report). Not persisted; cleared when a project is loaded.
 */

const MAX_LINES = 60
const lines: string[] = []

export type SessionActionEntry = {
  at: string
  line: string
}

export function recordSessionAction(line: string): void {
  const entry = `${new Date().toISOString()} ${line}`
  lines.push(entry)
  while (lines.length > MAX_LINES) lines.shift()
}

export function getSessionActionEntries(): SessionActionEntry[] {
  return lines.map((line) => {
    const space = line.indexOf(' ')
    if (space <= 0) {
      return { at: '', line }
    }
    return {
      at: line.slice(0, space),
      line: line.slice(space + 1),
    }
  })
}

export function getSessionActionLogText(): string {
  return lines.length > 0
    ? lines.join('\n')
    : '(Log unexpectedly empty — no entries since last project load.)'
}

export function clearSessionActionLog(): void {
  lines.length = 0
}
