import { DOMOTICA_MAX_ENDPOINT_OUTPUTS, DOMOTICA_MIN_ENDPOINT_OUTPUTS } from '@/lib/domoticaLayout'
import { useProjectStore } from '@/stores/projectStore'
import type { DomoticaOutputWireProps } from '@/types/schema'

export function clampDomoticaEndpointCount(count: number): number {
  return Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(DOMOTICA_MAX_ENDPOINT_OUTPUTS, Math.round(count))
  )
}

export function isDomoticaEndpointOnDcBus(endpointId: string): boolean {
  const info = useProjectStore.getState().findCircuitForEndpoint(endpointId)
  return (
    info?.circuit.branches?.some(
      (branch) => !!branch.dcBusId && branch.endpointIds.includes(endpointId)
    ) ?? false
  )
}

/** Resize a regular-panel domotica endpoint while keeping its output model consistent. */
export function resizeDomoticaEndpointCount(endpointId: string, requestedCount: number): boolean {
  const store = useProjectStore.getState()
  const endpoint = store.getEndpointById(endpointId)
  const info = store.findCircuitForEndpoint(endpointId)
  if (
    !endpoint ||
    endpoint.symbol !== 'domotica' ||
    !info ||
    isDomoticaEndpointOnDcBus(endpointId)
  ) {
    return false
  }

  const nextCount = clampDomoticaEndpointCount(requestedCount)
  const domoticaProps = endpoint.domoticaProps ?? {}
  const currentCount = clampDomoticaEndpointCount(
    domoticaProps.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS
  )
  if (nextCount === currentCount) return false

  const childEndpointIds = (domoticaProps.endpointChildEndpointIds ?? []).filter(
    (id) => !!store.getEndpointById(id)
  )
  const removedChildEndpointIds = childEndpointIds.splice(nextCount)
  const baseCable = info.circuit.cable
  const baseRoute = info.circuit.wireRoute ?? (info.circuit.inWall ? 'wall' : undefined)
  const baseInWall = info.circuit.inWall ?? false
  const baseHide = info.circuit.hideWireLabel
  const endpointOutputWires = [...(domoticaProps.endpointOutputWires ?? [])]

  while (endpointOutputWires.length < nextCount) {
    const wire: DomoticaOutputWireProps = {
      cable: { ...baseCable },
      inTube: info.circuit.inTube,
      wireRoute: baseRoute,
      inWall: baseInWall,
      hideWireLabel: baseHide,
    }
    endpointOutputWires.push(wire)
  }

  return store.withSingleUndoEntry(() => {
    if (removedChildEndpointIds.length > 0) {
      store.deleteEndpoints(removedChildEndpointIds)
    }
    store.updateEndpoint(endpointId, {
      domoticaProps: {
        ...domoticaProps,
        endpointCount: nextCount,
        endpointChildEndpointIds: childEndpointIds,
        endpointOutputWires: endpointOutputWires.slice(0, nextCount),
      },
    })
    return true
  })
}
