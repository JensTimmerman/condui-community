import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { logger } from '@/lib/logger'

/**
 * Auto-save hook that saves the project periodically when it's dirty
 * Saves every 30 seconds if there are unsaved changes
 */
export function useAutoSave({ disabled = false }: { disabled?: boolean } = {}) {
  const { isDirty, saveCurrentProject } = useProjectStore()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (disabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    if (isDirty) {
      // Clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }

      // Set up auto-save interval (30 seconds)
      intervalRef.current = setInterval(() => {
        const { isDirty: currentIsDirty } = useProjectStore.getState()
        if (currentIsDirty) {
          saveCurrentProject().catch((error: unknown) => {
            logger.error('Auto-save failed:', error)
          })
        }
      }, 30000) // 30 seconds

      // Also save immediately after a short delay (debounce rapid changes)
      const timeoutId = setTimeout(() => {
        const { isDirty: currentIsDirty } = useProjectStore.getState()
        if (currentIsDirty) {
          saveCurrentProject().catch((error: unknown) => {
            logger.error('Auto-save failed:', error)
          })
        }
      }, 2000) // 2 seconds delay

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
        clearTimeout(timeoutId)
      }
    } else {
      // Clear interval when not dirty
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return undefined
    }
  }, [disabled, isDirty, saveCurrentProject])
}
