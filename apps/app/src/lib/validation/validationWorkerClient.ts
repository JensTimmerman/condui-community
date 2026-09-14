import type { Issue, ValidationProject } from './core/types'

type ValidationWorkerResponse =
  | { type: 'result'; id: number; issues: Issue[] }
  | { type: 'error'; id: number; message: string }

let workerRef: Worker | null = null
let nextRequestId = 1
let cancelActiveRequest: (() => void) | null = null

/** Stop obsolete background work as soon as editing resumes. */
export function cancelActiveValidationWorker(): void {
  if (!cancelActiveRequest) return
  const cancel = cancelActiveRequest
  cancelActiveRequest = null
  workerRef?.terminate()
  workerRef = null
  cancel()
}

export function validationWorkerSupported(): boolean {
  return typeof Worker !== 'undefined'
}

function getWorker(): Worker | null {
  if (!validationWorkerSupported()) return null
  if (!workerRef) {
    try {
      if (import.meta.env.DEV) {
        // Vite can inject React Refresh into a transitive worker dependency. Its
        // runtime assumes `window`, even though validation itself is browser-free.
        // A tiny module bootstrap establishes the conventional worker alias before
        // dynamically importing the real entry. Production uses the direct URL.
        const workerUrl = new URL('../../workers/validation.worker.ts', import.meta.url)
        const bootstrapUrl = new URL('/validation-worker-bootstrap.js', globalThis.location.href)
        bootstrapUrl.searchParams.set('module', workerUrl.href)
        workerRef = new Worker(bootstrapUrl, { type: 'module' })
      } else {
        // Keep this exact constructor shape so Vite recognizes and emits a
        // same-origin worker chunk instead of treating the TS entry as an
        // inline generic asset (which production CSP intentionally blocks).
        workerRef = new Worker(new URL('../../workers/validation.worker.ts', import.meta.url), {
          type: 'module',
        })
      }
    } catch {
      workerRef = null
    }
  }
  return workerRef
}

export function validateProjectInWorker(project: ValidationProject): Promise<Issue[]> {
  // Validation is deliberately latest-only. A user can make several edits while
  // a large project is still being checked; letting those snapshots queue in one
  // worker makes the final result wait behind seconds of already-obsolete work.
  // Terminating also drops the structured clone retained by the stale request.
  cancelActiveValidationWorker()

  const worker = getWorker()
  if (!worker) return Promise.reject(new Error('Validation worker is unavailable'))

  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('messageerror', onMessageError)
      worker.removeEventListener('error', onError)
      if (cancelActiveRequest === cancel) cancelActiveRequest = null
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const cancel = () => {
      settle(() => reject(new DOMException('Superseded by a newer validation', 'AbortError')))
    }
    const onMessage = (event: MessageEvent<ValidationWorkerResponse>) => {
      const message = event.data
      if (message?.id !== id) return
      if (message.type === 'error') settle(() => reject(new Error(message.message)))
      else settle(() => resolve(message.issues))
    }
    const onMessageError = () => {
      settle(() => reject(new Error('Validation worker returned an unreadable response')))
    }
    const onError = (event: ErrorEvent) => {
      if (workerRef === worker) workerRef = null
      settle(() => reject(new Error(event.message || 'Validation worker failed to start')))
    }

    cancelActiveRequest = cancel
    worker.addEventListener('message', onMessage)
    worker.addEventListener('messageerror', onMessageError)
    worker.addEventListener('error', onError)
    try {
      worker.postMessage({
        type: 'validate',
        id,
        project,
        language:
          typeof document === 'undefined'
            ? 'nl-BE'
            : document.documentElement?.lang || 'nl-BE',
      })
    } catch (error) {
      settle(() => reject(error))
    }
  })
}
