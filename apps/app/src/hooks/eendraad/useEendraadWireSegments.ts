import { useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { deriveWires } from '@/lib/layout/deriveWires'
import { useLayoutTree } from './useLayoutTree'
import type { WireSegment } from '@/types/schema'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getSupplyAssembliesFromProject,
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
    return deriveWires(
      layoutTree,
      getElectricalPanelsFromProject(currentProject),
      installation,
      getSupplyAssembliesFromProject(currentProject),
      (deviceId) => resolveSupplyDeviceMounting(currentProject, deviceId)
    )
  }, [layoutTree, currentProject])
}
