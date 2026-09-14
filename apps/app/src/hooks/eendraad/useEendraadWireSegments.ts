import { useDeferredValue, useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useLayoutTree } from './useLayoutTree'
import type { WireSegment } from '@/types/schema'
import {
  getCachedEendraadWireSegments,
  getEendraadRenderProjectRevision,
} from '@/lib/layout/eendraadDerivedLayout'

/**
 * Hook to generate wire segments from the layout tree
 */
export function useEendraadWireSegments(enabled = true): WireSegment[] {
  const currentProject = useProjectStore((state: ProjectState) =>
    enabled && state.currentProject ? getEendraadRenderProjectRevision(state.currentProject) : null
  )
  const renderProject = useDeferredValue(currentProject)
  const layoutTree = useLayoutTree(enabled)

  return useMemo<WireSegment[]>(() => {
    if (!enabled || !layoutTree || !renderProject) return []
    return getCachedEendraadWireSegments(renderProject, layoutTree)
  }, [enabled, layoutTree, renderProject])
}
