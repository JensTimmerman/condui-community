import { useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { getAllEndpoints } from '@/utils/eendraad'
import type { Endpoint } from '@/types/schema'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'

/**
 * Hook to get all endpoints from all circuits, filtered by symbol scope
 */
export function useEendraadEndpoints(): Endpoint[] {
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)

  return useMemo(() => {
    if (!currentProject) return []
    return getAllEndpoints(getProjectElectricalPanels(currentProject))
  }, [currentProject])
}
