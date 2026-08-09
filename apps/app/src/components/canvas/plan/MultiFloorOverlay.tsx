import { memo, useMemo } from 'react'
import { Group, Line } from 'react-konva'
import type { Wall, Floor } from '@/types/schema'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { getWallPathPoints } from '@/lib/plan/wallCurve'

interface MultiFloorOverlayProps {
  currentFloor: Floor
  allFloors: Floor[]
  /** Master wall thickness in centimeters (used as fallback when wall.thickness is unset). */
  masterWallThickness: number
  theme?: 'light' | 'dark'
}

/**
 * Renders faint outlines of walls from floors above/below the active floor.
 */
function MultiFloorOverlayComponent({
  currentFloor,
  allFloors,
  masterWallThickness,
  theme = 'light',
}: MultiFloorOverlayProps) {
  // Keep adjacent-floor derivation stable between draw-move rerenders.
  const adjacentFloors = useMemo(() => {
    const currentFloorIndex = allFloors.findIndex((f) => f.id === currentFloor.id)
    return allFloors.filter((_, index) => Math.abs(index - currentFloorIndex) === 1)
  }, [allFloors, currentFloor.id])

  const overlayColor = theme === 'dark' ? '#4b5563' : '#9ca3af'
  const opacity = 0.2

  const getWallLinePoints = (wall: Wall): number[] => {
    const points: number[] = []
    getWallPathPoints(wall).forEach((p) => {
      points.push(p.x, p.y)
    })
    return points
  }

  const getWallThickness = (wall: Wall, floor: Floor): number => {
    const pxPerMeter = calculatePxPerMeter(floor)
    const thicknessCm = wall.thickness ?? masterWallThickness
    if (pxPerMeter != null) {
      // Convert centimeters to meters, then to pixels using this floor's scale.
      return (thicknessCm / 100) * pxPerMeter
    }
    // Fallback: interpret as raw canvas units when no scale is set.
    return thicknessCm
  }

  return (
    <Group opacity={opacity}>
      {adjacentFloors.map((floor) => {
        if (!floor.floorPlan) return null

        return (
          <Group key={`overlay-${floor.id}`}>
            {floor.floorPlan.walls.map((wall) => (
              <Line
                key={`overlay-wall-${wall.id}`}
                points={getWallLinePoints(wall)}
                stroke={overlayColor}
                strokeWidth={getWallThickness(wall, floor)}
                lineCap="round"
                lineJoin="round"
              />
            ))}
          </Group>
        )
      })}
    </Group>
  )
}

export const MultiFloorOverlay = memo(MultiFloorOverlayComponent)
MultiFloorOverlay.displayName = 'MultiFloorOverlay'
