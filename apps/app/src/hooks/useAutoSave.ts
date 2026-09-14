import { useEffect } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { logger } from '@/lib/logger'

const AUTOSAVE_IDLE_DELAY_MS = 5_000
const AUTOSAVE_MAX_DELAY_MS = 30_000

/**
 * Save after a short period without project mutations, with a 30-second upper
 * bound during continuous editing. Page suspension still flushes immediately.
 */
export function useAutoSave({ disabled = false }: { disabled?: boolean } = {}) {
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject)

  useEffect(() => {
    if (disabled) return
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let maxTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (maxTimer) clearTimeout(maxTimer)
      idleTimer = null
      maxTimer = null
    }
    const persistIfDirty = () => {
      clearTimers()
      if (!useProjectStore.getState().isDirty) return
      void saveCurrentProject().catch((error: unknown) => {
        logger.error('Auto-save failed:', error)
      })
    }
    const schedule = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(persistIfDirty, AUTOSAVE_IDLE_DELAY_MS)
      maxTimer ??= setTimeout(persistIfDirty, AUTOSAVE_MAX_DELAY_MS)
    }

    const initial = useProjectStore.getState()
    if (initial.isDirty) schedule()
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (!state.isDirty) {
        clearTimers()
        return
      }
      if (state.currentProject !== previous.currentProject) schedule()
    })

    return () => {
      unsubscribe()
      clearTimers()
    }
  }, [disabled, saveCurrentProject])

  useEffect(() => {
    if (disabled) return
    const flushDirtyProject = () => {
      const state = useProjectStore.getState()
      if (!state.isDirty) return
      void state.saveCurrentProject().catch((error: unknown) => {
        logger.error('Save before page suspension failed:', error)
      })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDirtyProject()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', flushDirtyProject)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', flushDirtyProject)
    }
  }, [disabled])
}
