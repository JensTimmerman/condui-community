import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'

export const CIRCUIT_CONVERTER_BLOCK_SIZE = 20
export const CIRCUIT_CONVERTER_MIN_CONNECTIONS = 1
export const CIRCUIT_CONVERTER_MAX_CONNECTIONS = 4
export const CIRCUIT_CONVERTER_OUTPUT_STUB_LENGTH = 26
export const CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING = 40
export const CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD = 25
/** Matches the converter entry in wireInsets.ts. */
export const CIRCUIT_CONVERTER_TOP_WIRE_INSET = 8

export function supportsCircuitConverterDcConnections(device: TrunkDevice | undefined): boolean {
  return (
    device?.symbol === 'inverter' ||
    device?.symbol === 'rectifier' ||
    device?.symbol === 'dc_dc_converter'
  )
}

export function getCircuitConverterDcConnectionCount(device: TrunkDevice | undefined): number {
  if (!supportsCircuitConverterDcConnections(device)) return 1
  const value = Math.trunc(device?.conversionProps?.dcConnectionCount ?? 1)
  return Math.max(
    CIRCUIT_CONVERTER_MIN_CONNECTIONS,
    Math.min(CIRCUIT_CONVERTER_MAX_CONNECTIONS, value)
  )
}

export function getCircuitConverterBodyGeometry(
  device: TrunkDevice,
  anchor: { x: number; y: number }
) {
  const count = getCircuitConverterDcConnectionCount(device)
  const width = CIRCUIT_CONVERTER_BLOCK_SIZE * count
  const height = CIRCUIT_CONVERTER_BLOCK_SIZE
  const left = anchor.x - CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  const top = anchor.y - height / 2
  return {
    count,
    width,
    height,
    left,
    right: left + width,
    top,
    bottom: top + height,
    center: { x: left + width / 2, y: anchor.y },
    anchor,
    dcPorts: Array.from({ length: count }, (_, index) => ({
      index,
      x: anchor.x + index * CIRCUIT_CONVERTER_BLOCK_SIZE,
      y: anchor.y - CIRCUIT_CONVERTER_TOP_WIRE_INSET,
    })),
  }
}

/**
 * Supply-assembly converters keep their established electrical anchor on the right.
 * Extra converter blocks therefore occupy space to the left of that anchor.
 */
export function getSupplyConverterBodyGeometry(
  device: TrunkDevice,
  anchor: { x: number; y: number }
) {
  const count = getCircuitConverterDcConnectionCount(device)
  const width = CIRCUIT_CONVERTER_BLOCK_SIZE * count
  const height = CIRCUIT_CONVERTER_BLOCK_SIZE
  const right = anchor.x + CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  const top = anchor.y - height / 2
  return {
    count,
    width,
    height,
    left: right - width,
    right,
    top,
    bottom: top + height,
    center: { x: right - width / 2, y: anchor.y },
    anchor,
  }
}

export function getCircuitConverterOutputRowY(
  device: TrunkDevice,
  anchorY: number,
  connectionIndex: number
): number {
  const count = getCircuitConverterDcConnectionCount(device)
  const safeIndex = Math.max(0, Math.min(count - 1, Math.trunc(connectionIndex)))
  const bodyTop = anchorY - CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  // Left rows sit highest. This keeps a row from crossing the vertical stubs to its right.
  return (
    bodyTop -
    CIRCUIT_CONVERTER_OUTPUT_STUB_LENGTH -
    (count - 1 - safeIndex) * CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING
  )
}

export function isCircuitConverterDcChild(endpoint: Endpoint, converterId?: string): boolean {
  const props = endpoint.converterDcConnection
  return !!props && (!converterId || props.converterId === converterId)
}

/**
 * The original endpoint branch becomes output zero when an ordinary-circuit
 * converter is widened. Keeping that ownership derived avoids changing the
 * persisted shape of projects that already have a normal first branch.
 */
export function getCircuitConverterPrimaryBranch(circuit: Circuit, device: TrunkDevice) {
  if (getCircuitConverterDcConnectionCount(device) <= 1) return undefined
  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  return (circuit.branches ?? []).find((branch) => {
    const endpoints = branch.endpointIds
      .map((endpointId) => endpointById.get(endpointId))
      .filter((endpoint): endpoint is Endpoint => endpoint !== undefined)
    return (
      endpoints.length > 0 &&
      endpoints.every(
        (endpoint) =>
          endpoint.symbol !== 'panel_distribution' && !isCircuitConverterDcChild(endpoint)
      )
    )
  })
}

export function getCircuitConverterPrimaryEndpointIds(circuit: Circuit): Set<string> {
  const device = (circuit.trunkDevices ?? []).find(
    (candidate) =>
      supportsCircuitConverterDcConnections(candidate) &&
      getCircuitConverterDcConnectionCount(candidate) > 1
  )
  return new Set(
    device ? (getCircuitConverterPrimaryBranch(circuit, device)?.endpointIds ?? []) : []
  )
}
