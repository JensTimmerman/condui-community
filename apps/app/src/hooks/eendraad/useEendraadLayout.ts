import { useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { calculateBottomUpLayout, type BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import type { Point } from '@/types/ui'

/**
 * Hook to calculate the eendraad layout from the current project and layout overrides
 */
export function useEendraadLayout(): BottomUpLayoutResult | null {
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const eendraadLayoutOverrides = useUIStore((state: UIState) => state.eendraadLayoutOverrides)

  return useMemo<BottomUpLayoutResult | null>(() => {
    if (!currentProject) return null

    // Convert Map to format expected by layout engine
    const overrides = new Map<string, Point>()
    eendraadLayoutOverrides.forEach((value, key) => {
      overrides.set(key, value)
    })

    return calculateBottomUpLayout(currentProject, overrides)
  }, [currentProject, eendraadLayoutOverrides])
}
