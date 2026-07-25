import { Group, Line, Path } from 'react-konva'
import {
  PLAN_WIRE_ACTIVE_OPACITY,
  PLAN_WIRE_DASH,
  PLAN_WIRE_STROKE_WIDTH,
} from '@/lib/plan/planWiring'

export type PlanWireDragPreviewModel = {
  stroke: string
  path: string | null
  points: number[] | null
  arrowHead: number[] | null
}

export function PlanWireDragPreview({ preview }: { preview: PlanWireDragPreviewModel }) {
  return (
    <Group name="plan-wire-drag-preview" listening={false}>
      {preview.path ? (
        <Path
          data={preview.path}
          stroke={preview.stroke}
          strokeWidth={PLAN_WIRE_STROKE_WIDTH}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          dash={PLAN_WIRE_DASH}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : preview.points ? (
        <Line
          points={preview.points}
          stroke={preview.stroke}
          strokeWidth={PLAN_WIRE_STROKE_WIDTH}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          dash={PLAN_WIRE_DASH}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : null}
      {preview.arrowHead && (
        <Line
          points={preview.arrowHead}
          stroke={preview.stroke}
          strokeWidth={2}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  )
}
