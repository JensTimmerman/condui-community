import { usePlanDragPositionsMap } from '@/stores/planDragVisualStore'
import { PlanWiresLayer } from './PlanWiresLayer'
import type { ComponentProps } from 'react'

type PlanWiresLayerProps = ComponentProps<typeof PlanWiresLayer>

export function PlanWiresLayerWithDrag(props: Omit<PlanWiresLayerProps, 'placementPositionOverrides'>) {
  const placementPositionOverrides = usePlanDragPositionsMap()
  return <PlanWiresLayer {...props} placementPositionOverrides={placementPositionOverrides} />
}
