/**
 * In-memory ring buffer of coarse client events for crash reports only.
 * Not persisted; cleared on full page reload.
 */

export type ClientLogKind = 'route' | 'action' | 'api_failure' | 'warn' | 'error'

export type ClientLogEntry = {
  t: string
  kind: ClientLogKind
  message: string
}

const MAX_ENTRIES = 50
const buffer: ClientLogEntry[] = []

function truncateLogMessage(message: string, max = 400): string {
  const s = message.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

export function appendClientLog(entry: { kind: ClientLogKind; message: string }): void {
  try {
    buffer.push({
      t: new Date().toISOString(),
      kind: entry.kind,
      message: truncateLogMessage(entry.message, 500),
    })
    while (buffer.length > MAX_ENTRIES) buffer.shift()
  } catch {
    // Never throw from logging
  }
}

export function getClientLogForCrashReport(): ClientLogEntry[] {
  try {
    return buffer.slice()
  } catch {
    return []
  }
}
