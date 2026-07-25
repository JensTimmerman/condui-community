import React from 'react'
import ScaleRulerCanvas from '@/components/plan/ScaleRulerCanvas'
import type { ProjectState } from '@/stores/projectStore'
import type { Floor, Point2 } from '@/types/schema'

export function PlanScaleRulerCanvasLayer({
  activeFloorId,
  getFloorById,
  handleScaleRulerCancel,
  handleScaleRulerComplete,
  isResettingScale,
  planImage,
  planImagePosition,
  scaleRulerCommitSignal,
  scaleRulerMeters,
  setScaleRulerMeters,
  setScaleRulerMetersInput,
  setScaleRulerPoints,
  zoom,
}: {
  activeFloorId: string | null
  getFloorById: ProjectState['getFloorById']
  handleScaleRulerCancel: () => void
  handleScaleRulerComplete: (p1: Point2, p2: Point2, meters: number) => void
  isResettingScale: boolean
  planImage: unknown
  planImagePosition: Point2
  scaleRulerCommitSignal: number
  scaleRulerMeters: number | null
  setScaleRulerMeters: React.Dispatch<React.SetStateAction<number | null>>
  setScaleRulerMetersInput: React.Dispatch<React.SetStateAction<string>>
  setScaleRulerPoints: React.Dispatch<
    React.SetStateAction<{
      p1: Point2 | null
      p2: Point2 | null
    }>
  >
  zoom: number
}) {
  if (!isResettingScale) return null
  const activeFloorForScale: Floor | null = activeFloorId
    ? (getFloorById(activeFloorId) ?? null)
    : null
  const existingReferenceLocal = activeFloorForScale?.scale?.reference ?? null
  const existingReferenceWorld =
    existingReferenceLocal && planImage
      ? {
          p1: {
            x: existingReferenceLocal.p1.x + planImagePosition.x,
            y: existingReferenceLocal.p1.y + planImagePosition.y,
          },
          p2: {
            x: existingReferenceLocal.p2.x + planImagePosition.x,
            y: existingReferenceLocal.p2.y + planImagePosition.y,
          },
          meters: existingReferenceLocal.meters,
        }
      : null
  const rulerKey = existingReferenceLocal
    ? `scale-${activeFloorForScale?.id}-${existingReferenceLocal.meters}-${existingReferenceLocal.p1.x}-${existingReferenceLocal.p1.y}-${existingReferenceLocal.p2.x}-${existingReferenceLocal.p2.y}`
    : `scale-${activeFloorForScale?.id}-none`

  return (
    <ScaleRulerCanvas
      key={rulerKey}
      onComplete={handleScaleRulerComplete}
      onCancel={handleScaleRulerCancel}
      initialReference={existingReferenceWorld}
      onPointsReady={(startPoint: Point2, endPoint: Point2, meters: number) => {
        setScaleRulerPoints({
          p1: { x: startPoint.x, y: startPoint.y },
          p2: { x: endPoint.x, y: endPoint.y },
        })
        setScaleRulerMeters(meters)
        setScaleRulerMetersInput(String(meters))
      }}
      meters={scaleRulerMeters ?? existingReferenceLocal?.meters ?? 1}
      onMetersChange={(meters: number) => {
        setScaleRulerMeters(meters)
        setScaleRulerMetersInput(String(meters))
      }}
      commitSignal={scaleRulerCommitSignal}
      zoom={zoom}
    />
  )
}
