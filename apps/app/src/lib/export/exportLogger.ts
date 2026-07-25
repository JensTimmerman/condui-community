import { logger } from '@/lib/logger'

function isExportVerbose(): boolean {
  if (!import.meta.env.DEV) return false
  if (import.meta.env.VITE_EXPORT_VERBOSE === '1') return true
  try {
    return localStorage.getItem('eendra:export-verbose') === '1'
  } catch {
    return false
  }
}

/** Detailed export tracing; off by default. Set `localStorage.eendra:export-verbose = '1'` in dev. */
export function exportLog(...args: unknown[]): void {
  if (isExportVerbose()) logger.debug(...args)
}
