import type { Endpoint, Placement, TrunkDevice } from '@/types/schema'

export type PlanMarqueePlacement = Placement & {
  endpointId?: string
  trunkDeviceId?: string
}

export interface PlanMarqueePlacementOwner {
  endpoint?: Endpoint
  trunkDevice?: TrunkDevice
  selectionIds: string[]
  socketCount: number
  symbol: string | undefined
}

/** IDs by which a regular plan placement can participate in a mixed selection. */
export function getPlanPlacementSelectionIds(placement: PlanMarqueePlacement): string[] {
  return [
    placement.id,
    ...(placement.endpointId ? [placement.endpointId] : []),
    ...(placement.trunkDeviceId ? [placement.trunkDeviceId] : []),
  ]
}

/** Resolve every regular situation-plan placement that participates in marquee hit-testing. */
export function resolvePlanMarqueePlacementOwner(
  placement: PlanMarqueePlacement,
  getEndpointById: (id: string) => Endpoint | undefined,
  getTrunkDeviceById: (id: string) => TrunkDevice | undefined
): PlanMarqueePlacementOwner | null {
  const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
  const trunkDevice = placement.trunkDeviceId
    ? getTrunkDeviceById(placement.trunkDeviceId)
    : undefined

  if (!endpoint && !trunkDevice) return null

  return {
    endpoint,
    trunkDevice,
    selectionIds: getPlanPlacementSelectionIds(placement),
    socketCount: (endpoint?.type === 'socket' ? endpoint.socketProps?.socketCount : undefined) || 1,
    symbol: endpoint?.symbol ?? trunkDevice?.symbol,
  }
}
