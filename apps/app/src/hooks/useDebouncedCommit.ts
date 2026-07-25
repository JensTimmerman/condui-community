import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Keep a fast local draft value and commit it after inactivity.
 *
 * Intended for text inputs where committing every keystroke to the global store
 * causes expensive downstream recomputation (layout, history snapshots, etc.).
 *
 * Behavior:
 * - Draft updates immediately via setDraft (use as input value)
 * - Commit fires after `delayMs` of no draft changes
 * - Commit flushes on blur via `flush()`
 */
export function useDebouncedCommit<T>(
  committedValue: T,
  onCommit: (value: T) => void,
  options: {
    delayMs?: number
    identityKey?: unknown
    /**
     * Equality check to avoid redundant commits. Defaults to Object.is.
     */
    equals?: (a: T, b: T) => boolean
  } = {}
): {
  draft: T
  setDraft: (value: T) => void
  flush: () => void
  resetDraft: () => void
  isDirty: boolean
} {
  const delayMs = options.delayMs ?? 500
  const equals = options.equals ?? Object.is
  const identityKey = options.identityKey

  const lastCommittedRef = useRef(committedValue)
  const [draft, _setDraft] = useState<T>(committedValue)
  const committedRef = useRef(committedValue)
  committedRef.current = committedValue

  const draftRef = useRef(draft)
  draftRef.current = draft

  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const flush = useCallback(() => {
    clearTimer()
    const latestDraft = draftRef.current
    const latestCommitted = committedRef.current
    if (!equals(latestDraft, latestCommitted)) {
      onCommit(latestDraft)
    }
  }, [equals, onCommit])

  const resetDraft = useCallback(() => {
    clearTimer()
    _setDraft(committedRef.current)
  }, [])

  // Keep draft in sync when the committed value changes externally and the
  // user hasn't diverged (or when store updates come in from elsewhere).
  useEffect(() => {
    const latestDraft = draftRef.current
    const prevCommitted = lastCommittedRef.current
    lastCommittedRef.current = committedValue
    if (equals(latestDraft, committedValue)) return

    // If user hadn't diverged (draft matched previous committed), adopt the new committed value.
    if (equals(latestDraft, prevCommitted)) {
      _setDraft(committedValue)
    }
  }, [committedValue, equals])

  const setDraft = useCallback(
    (value: T) => {
      _setDraft(value)
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        flush()
      }, delayMs)
    },
    [delayMs, flush]
  )

  // Do not commit from passive unmount cleanup. Selection/layout changes can
  // unmount property inputs while the store is already updating; committing a
  // stale draft from here can create nested Zustand/React update loops.
  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [])

  // When the logical backing entity changes, drop any pending draft and adopt
  // the new committed value immediately so stale edits cannot leak across items.
  useEffect(() => {
    clearTimer()
    lastCommittedRef.current = committedValue
    _setDraft(committedValue)
  }, [identityKey, committedValue])

  const isDirty = !equals(draft, committedValue)

  return { draft, setDraft, flush, resetDraft, isDirty }
}
