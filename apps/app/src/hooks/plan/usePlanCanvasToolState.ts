import { useEffect, useState } from 'react'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'
import { useUIStore } from '@/stores/uiStore'

export type OpeningSelectionArmedTool = 'insertDoor' | 'insertWindow' | null
export type PlanFloatingMenu = 'grid' | 'floor' | 'visibility' | null

export function usePlanCanvasToolState() {
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const activeTool = useUIStore((state) => state.activePlanTool)
  const setActiveTool = useUIStore((state) => state.setActivePlanTool)
  const [openingSelectionArmedTool, setOpeningSelectionArmedTool] =
    useState<OpeningSelectionArmedTool>(null)
  const [, setSelectedPlanImageId] = useState<string | null>(null)
  const [isFloorPlanMode, setIsFloorPlanMode] = useState(false)
  const [selectedGraphicAssetId, setSelectedGraphicAssetId] = useState(
    PLAN_GRAPHIC_ELEMENT_ASSETS[0]?.id ?? ''
  )
  const [isViewportPanning, setIsViewportPanning] = useState(false)
  const [openMenu, setOpenMenu] = useState<PlanFloatingMenu>(null)

  useEffect(() => () => setActiveTool('none'), [setActiveTool])

  return {
    isImportDialogOpen,
    setIsImportDialogOpen,
    activeTool,
    setActiveTool,
    openingSelectionArmedTool,
    setOpeningSelectionArmedTool,
    setSelectedPlanImageId,
    isFloorPlanMode,
    setIsFloorPlanMode,
    selectedGraphicAssetId,
    setSelectedGraphicAssetId,
    isViewportPanning,
    setIsViewportPanning,
    openMenu,
    setOpenMenu,
  }
}
