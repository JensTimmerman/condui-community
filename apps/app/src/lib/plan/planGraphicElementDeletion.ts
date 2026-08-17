import type { Selection } from '@/types/ui'

type GraphicElementSelection = Pick<Selection, 'type' | 'ids'>

/**
 * Delete the selected plan graphics through the store action directly. The
 * selection is the authority here: re-validating against a separately derived
 * floor snapshot can reject a graphic that is visibly selected on the canvas.
 */
export function deleteSelectedPlanGraphicElements(
  selection: GraphicElementSelection,
  deletePlanGraphicElement: (elementId: string) => void
): boolean {
  if (selection.type !== 'graphicElement') return false

  const elementIds = Array.from(new Set(selection.ids.filter(Boolean)))
  if (elementIds.length === 0) return false

  elementIds.forEach((elementId) => deletePlanGraphicElement(elementId))
  return true
}
