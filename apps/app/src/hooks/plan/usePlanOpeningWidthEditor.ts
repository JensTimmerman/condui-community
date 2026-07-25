import { useEffect, useMemo, useRef, useState } from 'react'
import { computeOpeningGeometry } from '@/handlers/plan/wallDrawing'
import type { Door, Floor, Point2, Wall, Window } from '@/types/schema'
import type { Selection } from '@/types/ui'
import type { ProjectState } from '@/stores/projectStore'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

export type PlanOpeningWidthEditorModel = {
  kind: 'door' | 'window'
  id: string
  width: number
  center: Point2
  tangent: Point2
  doorDirection: Door['direction'] | null
  doorSwing: Door['swing'] | null
}

type UsePlanOpeningWidthEditorOptions = {
  activeFloor: Floor | null | undefined
  activeTool: string
  canvasPxPerMeter: number
  canEditFloorPlan: boolean
  doorsForRender: Door[]
  isFloorPlanMode: boolean
  selection: Selection
  updateDoor: ProjectState['updateDoor']
  updateWindow: ProjectState['updateWindow']
  windowsForRender: Window[]
}

export function usePlanOpeningWidthEditor({
  activeFloor,
  activeTool,
  canvasPxPerMeter,
  canEditFloorPlan,
  doorsForRender,
  isFloorPlanMode,
  selection,
  updateDoor,
  updateWindow,
  windowsForRender,
}: UsePlanOpeningWidthEditorOptions) {
  const commitTimeoutRef = useRef<number | null>(null)
  const lastTypedAtRef = useRef<number>(0)
  const appendWindowMsRef = useRef<number>(3000)
  const [openingWidthText, setOpeningWidthText] = useState('')
  const [openingWidthEditorActive, setOpeningWidthEditorActive] = useState(false)

  const selectedOpeningForWidthEditor = useMemo<PlanOpeningWidthEditorModel | null>(() => {
    const canShowInTool =
      activeTool === 'select' || activeTool === 'insertDoor' || activeTool === 'insertWindow'
    if (!isFloorPlanMode || !canShowInTool || !activeFloor?.floorPlan) return null
    if ((selection.type !== 'door' && selection.type !== 'window') || selection.ids.length !== 1) {
      return null
    }

    const openingId = selection.ids[0]
    const isDoor = selection.type === 'door'
    const opening = isDoor
      ? doorsForRender.find((door) => door.id === openingId)
      : windowsForRender.find((window) => window.id === openingId)
    if (!opening) return null

    const wall = activeFloor.floorPlan.walls.find((candidate: Wall) => candidate.id === opening.wallId)
    if (!wall) return null

    const geom = computeOpeningGeometry(wall.points, opening.position)
    if (!geom) return null

    return {
      kind: selection.type,
      id: opening.id,
      width: opening.width,
      center: geom.center,
      tangent: geom.tangent,
      doorDirection: isDoor ? ((opening as Door).direction ?? 'out') : null,
      doorSwing: isDoor ? ((opening as Door).swing ?? 'right') : null,
    }
  }, [
    activeFloor,
    activeTool,
    doorsForRender,
    isFloorPlanMode,
    selection.ids,
    selection.type,
    windowsForRender,
  ])

  useEffect(() => {
    if (!selectedOpeningForWidthEditor) {
      setOpeningWidthText('')
      setOpeningWidthEditorActive(false)
      lastTypedAtRef.current = 0
      if (commitTimeoutRef.current != null) {
        clearTimeout(commitTimeoutRef.current)
        commitTimeoutRef.current = null
      }
      return
    }

    const widthDisplay = (selectedOpeningForWidthEditor.width / canvasPxPerMeter) * 100
    setOpeningWidthText(
      Number.isFinite(widthDisplay) ? `${Math.round(widthDisplay * 10) / 10}` : ''
    )
    setOpeningWidthEditorActive(false)
    lastTypedAtRef.current = 0
    if (commitTimeoutRef.current != null) {
      clearTimeout(commitTimeoutRef.current)
      commitTimeoutRef.current = null
    }
  }, [canvasPxPerMeter, selectedOpeningForWidthEditor])

  useEffect(() => {
    if (!selectedOpeningForWidthEditor) return
    if (commitTimeoutRef.current != null) {
      clearTimeout(commitTimeoutRef.current)
    }
    commitTimeoutRef.current = window.setTimeout(() => {
      const parsed = parseFloat(openingWidthText.trim().replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed <= 0) return
      const widthPx = (parsed / 100) * canvasPxPerMeter
      if (!Number.isFinite(widthPx) || widthPx <= 0) return
      if (Math.abs(widthPx - selectedOpeningForWidthEditor.width) < 1e-4) return
      if (selectedOpeningForWidthEditor.kind === 'door') {
        updateDoor(selectedOpeningForWidthEditor.id, { width: widthPx })
      } else {
        updateWindow(selectedOpeningForWidthEditor.id, { width: widthPx })
      }
    }, 350)
    return () => {
      if (commitTimeoutRef.current != null) {
        clearTimeout(commitTimeoutRef.current)
        commitTimeoutRef.current = null
      }
    }
  }, [canvasPxPerMeter, openingWidthText, selectedOpeningForWidthEditor, updateDoor, updateWindow])

  useEffect(() => {
    if (!selectedOpeningForWidthEditor) return
    const handleOpeningWidthKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (!canEditFloorPlan) return

      if (event.key === 'Backspace') {
        event.preventDefault()
        setOpeningWidthEditorActive(true)
        setOpeningWidthText((prev) => prev.slice(0, -1))
        lastTypedAtRef.current = Date.now()
        return
      }
      if (event.key.length === 1 && /[0-9.,]/.test(event.key)) {
        event.preventDefault()
        const now = Date.now()
        const shouldReplace =
          lastTypedAtRef.current === 0 || now - lastTypedAtRef.current > appendWindowMsRef.current
        setOpeningWidthEditorActive(true)
        setOpeningWidthText((prev) => (shouldReplace ? event.key : `${prev}${event.key}`))
        lastTypedAtRef.current = now
      }
    }
    window.addEventListener('keydown', handleOpeningWidthKeyDown)
    return () => window.removeEventListener('keydown', handleOpeningWidthKeyDown)
  }, [canEditFloorPlan, selectedOpeningForWidthEditor])

  return {
    openingWidthEditorActive,
    openingWidthText,
    selectedOpeningForWidthEditor,
    setOpeningWidthEditorActive,
  }
}
