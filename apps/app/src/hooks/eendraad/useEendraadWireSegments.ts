import { useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { deriveWires } from '@/lib/layout/deriveWires'
import { useLayoutTree } from './useLayoutTree'
import type { WireSegment } from '@/types/schema'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'

/**
 * Hook to generate wire segments from the layout tree
 */
export function useEendraadWireSegments(): WireSegment[] {
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const layoutTree = useLayoutTree()
  
  return useMemo<WireSegment[]>(() => {
    if (!layoutTree || !currentProject) return []

    const installation = getElectricalInstallationFromProject(currentProject)
    if (!installation) return []
    return deriveWires(layoutTree, getElectricalPanelsFromProject(currentProject), installation)
  }, [layoutTree, currentProject])
}
