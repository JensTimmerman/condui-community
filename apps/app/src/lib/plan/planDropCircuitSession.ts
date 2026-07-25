import { useProjectStore } from '@/stores/projectStore'

export function finalizePlanDropCircuitPickerUndoGroup(undoGroupStartIndex: number): void {
  useProjectStore.getState().collapseUndoGroupFromIndex(undoGroupStartIndex)
}
