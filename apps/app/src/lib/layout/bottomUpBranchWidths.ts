import { MULTI_SOCKET_OFFSET } from '@/components/canvas/eendraad/canvasSymbols'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/components/canvas/eendraad/canvasSymbols'
import type { Endpoint } from '@/types/schema'

/** X offset from branch.branchX for each endpoint (includes appliance-after-socket gap). */
export function getEndpointXOffsets(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number
): number[] {
  const result: number[] = []
  let x = leadIn
  for (let i = 0; i < branchEndpoints.length; i++) {
    result.push(x)
    const ep = branchEndpoints[i]
    const next = branchEndpoints[i + 1]
    if (next) {
      const extra =
        ep?.type === 'socket' && next?.type === 'fixed_appliance' ? applianceAfterSocketGap : 0
      x += endpointSpacing + extra
    }
  }
  return result
}

export function getDomoticaRowChainIndex(branchEndpoints: Endpoint[], endpoint: Endpoint): number {
  const ref = endpoint.domoticaChildProps
  if (!ref) return 0

  const rowEndpoints = branchEndpoints.filter(
    (candidate) =>
      candidate.domoticaChildProps?.parentEndpointId === ref.parentEndpointId &&
      candidate.domoticaChildProps.outputIndex === ref.outputIndex
  )
  const index = rowEndpoints.findIndex((candidate) => candidate.id === endpoint.id)
  return index >= 0 ? index : 0
}

/**
 * Calculate horizontal branch width accounting for multi-socket endpoints and appliance-after-socket gap.
 */
export function calculateBranchWidth(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number
): number {
  const domotica = branchEndpoints.find((ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps)
  if (domotica) {
    const endpointCount = Math.max(
      DOMOTICA_MIN_ENDPOINT_OUTPUTS,
      Math.min(
        DOMOTICA_MAX_ENDPOINT_OUTPUTS,
        Math.trunc(domotica.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
      )
    )
    const offsets = getEndpointXOffsets(
      branchEndpoints,
      leadIn,
      endpointSpacing,
      applianceAfterSocketGap
    )
    const domoticaIndex = branchEndpoints.indexOf(domotica)
    const domoticaParentOffset = domoticaIndex >= 0 ? (offsets[domoticaIndex] ?? leadIn) : leadIn
    const rowCounts = new Map<number, number>()
    for (const endpoint of branchEndpoints) {
      if (endpoint.domoticaChildProps?.parentEndpointId !== domotica.id) continue
      const index = endpoint.domoticaChildProps.outputIndex
      rowCounts.set(index, (rowCounts.get(index) ?? 0) + 1)
    }
    const maxRowChainLength = Math.max(1, ...rowCounts.values())
    const maxWireReach =
      domoticaParentOffset +
      DOMOTICA_BOX_WIDTH / 2 +
      DOMOTICA_BRANCH_LEAD +
      (maxRowChainLength - 1) * endpointSpacing
    const outputStackHeight =
      DOMOTICA_BASE_HEIGHT + Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING
    return Math.max(leadIn, maxWireReach, outputStackHeight / 4)
  }

  const count = branchEndpoints.length
  if (count === 0) return leadIn

  const offsets = getEndpointXOffsets(
    branchEndpoints,
    leadIn,
    endpointSpacing,
    applianceAfterSocketGap
  )
  let maxRight = leadIn
  for (let i = 0; i < count; i++) {
    const ep = branchEndpoints[i]
    if (!ep) continue
    const socketExtra =
      ep.type === 'socket'
        ? Math.max(0, (ep.socketProps?.socketCount || 1) - 1) * MULTI_SOCKET_OFFSET
        : 0
    const wideSymbolExtra =
      ep.symbol === 'energy_meter' ||
      ep.symbol === 'transformer' ||
      ep.symbol === 'rectifier' ||
      ep.symbol === 'inverter' ||
      ep.symbol === 'dc_dc_converter'
        ? endpointSpacing
        : 0

    maxRight = Math.max(maxRight, (offsets[i] ?? leadIn) + socketExtra + wideSymbolExtra)
  }
  return maxRight
}
