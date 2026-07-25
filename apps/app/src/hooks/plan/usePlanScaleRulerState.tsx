import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { pointInPolygon } from '@/lib/geometry'
import { getRoomPolygonsFromWalls } from '@/lib/plan/roomPolygons'
import type { DialogConfig } from '@/stores/dialogStore'
import type { ProjectState } from '@/stores/projectStore'
import type { Door, Floor, PlanGraphicElement, Point2, Wall, Window } from '@/types/schema'
import { calculatePxPerMeter } from './usePlanScale'

export function usePlanScaleRulerState() {
  const [isResettingScale, setIsResettingScale] = useState(false)
  const [scaleRulerPoints, setScaleRulerPoints] = useState<{
    p1: Point2 | null
    p2: Point2 | null
  }>({ p1: null, p2: null })
  const [scaleRulerMeters, setScaleRulerMeters] = useState<number | null>(null)
  const [scaleRulerMetersInput, setScaleRulerMetersInput] = useState('')
  const [scaleRulerCommitSignal, setScaleRulerCommitSignal] = useState(0)

  return {
    isResettingScale,
    setIsResettingScale,
    scaleRulerPoints,
    setScaleRulerPoints,
    scaleRulerMeters,
    setScaleRulerMeters,
    scaleRulerMetersInput,
    setScaleRulerMetersInput,
    scaleRulerCommitSignal,
    setScaleRulerCommitSignal,
  }
}

type UsePlanScaleResetControllerOptions = {
  activeFloor: Floor | null | undefined
  activeFloorId: string | null
  activeTool: string
  applyPlanRescale: ProjectState['applyPlanRescale']
  cancelResetScaleTrigger: number
  getFloorById: ProjectState['getFloorById']
  getPlacementsByFloor: ProjectState['getPlacementsByFloor']
  openDialog: (config: DialogConfig) => void
  setActiveTool: (tool: 'none' | 'resetScale') => void
  t: TFunction
  updateFloor: ProjectState['updateFloor']
}

export function usePlanScaleResetController({
  activeFloor,
  activeFloorId,
  activeTool,
  applyPlanRescale,
  cancelResetScaleTrigger,
  getFloorById,
  getPlacementsByFloor,
  openDialog,
  setActiveTool,
  t,
  updateFloor,
}: UsePlanScaleResetControllerOptions) {
  const state = usePlanScaleRulerState()
  const {
    isResettingScale,
    scaleRulerMeters,
    scaleRulerPoints,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  } = state
  const lastSeenCancelResetScaleTriggerRef = useRef(cancelResetScaleTrigger)

  const tempPxPerMeter =
    isResettingScale &&
    scaleRulerPoints.p1 &&
    scaleRulerPoints.p2 &&
    (scaleRulerMeters ?? activeFloor?.scale?.reference?.meters)
      ? (() => {
          const { p1, p2 } = scaleRulerPoints
          const meters = scaleRulerMeters ?? activeFloor!.scale!.reference!.meters
          const dx = p2!.x - p1!.x
          const dy = p2!.y - p1!.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          return dist > 0 && meters > 0 ? dist / meters : null
        })()
      : null

  const handleResetScaleStart = useCallback(() => {
    const floor = activeFloorId ? getFloorById(activeFloorId) : null
    const initialMeters = scaleRulerMeters ?? floor?.scale?.reference?.meters ?? 1
    setIsResettingScale(true)
    setScaleRulerPoints({ p1: null, p2: null })
    setScaleRulerMeters(initialMeters)
    setScaleRulerMetersInput(String(initialMeters))
    setActiveTool('resetScale')
  }, [
    activeFloorId,
    getFloorById,
    scaleRulerMeters,
    setActiveTool,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  ])

  const handleScaleRulerCancel = useCallback(() => {
    setIsResettingScale(false)
    setScaleRulerPoints({ p1: null, p2: null })
    setScaleRulerMeters(null)
    setScaleRulerMetersInput('')
    setActiveTool('none')
  }, [
    setActiveTool,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  ])

  const handleScaleRulerComplete = useCallback(
    (p1World: Point2, p2World: Point2, meters: number, currentPlanImagePosition: Point2) => {
      if (!activeFloorId) return

      const floorBefore = getFloorById(activeFloorId)
      if (!floorBefore) return

      setIsResettingScale(false)
      setScaleRulerPoints({ p1: null, p2: null })
      setScaleRulerMeters(null)
      setScaleRulerMetersInput('')
      setActiveTool('none')

      const localP1 = {
        x: p1World.x - currentPlanImagePosition.x,
        y: p1World.y - currentPlanImagePosition.y,
      }
      const localP2 = {
        x: p2World.x - currentPlanImagePosition.x,
        y: p2World.y - currentPlanImagePosition.y,
      }
      const newScaleReference = {
        p1: localP1,
        p2: localP2,
        meters,
        coordinateSpace: 'asset' as const,
      }
      const hasPlanImage = !!(floorBefore.planAsset || floorBefore.planImportAsset)
      const floorPlan = floorBefore.floorPlan
      const hasVectorWalls = !!floorPlan && floorPlan.walls.length > 0
      const hasExistingScaleReference = !!floorBefore.scale?.reference
      const oldPxPerMeter = calculatePxPerMeter(floorBefore)
      const dx = p2World.x - p1World.x
      const dy = p2World.y - p1World.y
      const distancePx = Math.sqrt(dx * dx + dy * dy)
      const newPxPerMeter = distancePx > 0 && meters > 0 ? distancePx / meters : null

      const shouldAttemptWallRescale =
        hasPlanImage &&
        hasVectorWalls &&
        hasExistingScaleReference &&
        oldPxPerMeter != null &&
        newPxPerMeter != null &&
        newPxPerMeter > 0

      if (!shouldAttemptWallRescale) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        return
      }

      const scaleFactor = newPxPerMeter! / oldPxPerMeter!
      if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 1e-3) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        return
      }

      const allPoints: Point2[] = []
      for (const wall of floorPlan!.walls) allPoints.push(...wall.points)
      if (allPoints.length === 0) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        setIsResettingScale(false)
        setScaleRulerPoints({ p1: null, p2: null })
        setScaleRulerMeters(null)
        setActiveTool('none')
        return
      }

      let sumX = 0
      let sumY = 0
      for (const point of allPoints) {
        sumX += point.x
        sumY += point.y
      }
      const center = { x: sumX / allPoints.length, y: sumY / allPoints.length }
      const roomPolygons = getRoomPolygonsFromWalls(floorPlan!.walls)
      const placementsOnFloor = getPlacementsByFloor(activeFloorId)
      const placementsToRescale: Array<{ id: string; pos: Point2 }> = []
      for (const placement of placementsOnFloor) {
        const pos = placement.pos ?? null
        if (!pos) continue
        for (const polygon of roomPolygons) {
          if (pointInPolygon(pos, polygon)) {
            placementsToRescale.push({ id: placement.id, pos })
            break
          }
        }
      }

      const title = t('plan.resetScale.confirmRescaleTitle')
      const intro = t('plan.resetScale.confirmRescaleIntro', { factor: scaleFactor.toFixed(2) })

      openDialog({
        type: 'custom',
        title,
        content: (
          <div className="text-gray-600 dark:text-gray-400 space-y-3">
            <p>{intro as React.ReactNode}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('plan.resetScale.optionRescale') as React.ReactNode}</li>
              <li>{t('plan.resetScale.optionKeep') as React.ReactNode}</li>
              <li>{t('plan.resetScale.optionCancel') as React.ReactNode}</li>
            </ul>
          </div>
        ),
        buttons: [
          {
            label: t('common.cancel'),
            variant: 'secondary',
            onClick: () => {
              // Cancel entire operation: keep existing scale and walls untouched.
            },
          },
          {
            label: t('plan.resetScale.confirmRescaleCancel'),
            variant: 'secondary',
            onClick: () => {
              const latestFloor = getFloorById(activeFloorId)
              if (latestFloor) {
                applyPlanRescale(activeFloorId, { scale: { reference: newScaleReference } }, [])
              }
            },
          },
          {
            label: t('plan.resetScale.confirmRescaleConfirm'),
            variant: 'primary',
            autoFocus: true,
            onClick: () => {
              const latestFloor = getFloorById(activeFloorId)
              const latestPlan = latestFloor?.floorPlan
              if (!latestFloor || !latestPlan) return

              const scaledWalls = latestPlan.walls.map((wall: Wall) => ({
                ...wall,
                points: wall.points.map((point: Point2) => ({
                  x: center.x + (point.x - center.x) * scaleFactor,
                  y: center.y + (point.y - center.y) * scaleFactor,
                })),
              }))
              const scaledDoors = latestPlan.doors.map((door: Door) => ({
                ...door,
                width: door.width * scaleFactor,
              }))
              const scaledWindows = latestPlan.windows.map((window: Window) => ({
                ...window,
                width: window.width * scaleFactor,
              }))
              const scaledGraphicElements = (latestPlan.graphicElements ?? []).map(
                (element: PlanGraphicElement) => ({
                  ...element,
                  pos: {
                    x: center.x + (element.pos.x - center.x) * scaleFactor,
                    y: center.y + (element.pos.y - center.y) * scaleFactor,
                  },
                  width: element.width * scaleFactor,
                  height: element.height * scaleFactor,
                }),
              )
              const placementUpdates = placementsToRescale.map(({ id, pos }) => ({
                id,
                pos: {
                  x: center.x + (pos.x - center.x) * scaleFactor,
                  y: center.y + (pos.y - center.y) * scaleFactor,
                },
              }))

              applyPlanRescale(
                activeFloorId,
                {
                  scale: { reference: newScaleReference },
                  floorPlan: {
                    ...latestPlan,
                    walls: scaledWalls,
                    doors: scaledDoors,
                    windows: scaledWindows,
                    graphicElements: scaledGraphicElements,
                  },
                },
                placementUpdates,
              )
            },
          },
        ],
      })
    },
    [
      activeFloorId,
      applyPlanRescale,
      getFloorById,
      getPlacementsByFloor,
      openDialog,
      setActiveTool,
      setIsResettingScale,
      setScaleRulerMeters,
      setScaleRulerMetersInput,
      setScaleRulerPoints,
      t,
      updateFloor,
    ],
  )

  useEffect(() => {
    if (cancelResetScaleTrigger === lastSeenCancelResetScaleTriggerRef.current) return
    lastSeenCancelResetScaleTriggerRef.current = cancelResetScaleTrigger
    if (isResettingScale || activeTool === 'resetScale') {
      handleScaleRulerCancel()
    }
  }, [cancelResetScaleTrigger, isResettingScale, activeTool, handleScaleRulerCancel])

  return {
    ...state,
    handleResetScaleStart,
    handleScaleRulerCancel,
    handleScaleRulerComplete,
    tempPxPerMeter,
  }
}
