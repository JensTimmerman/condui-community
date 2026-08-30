import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  CIRCUIT_CONVERTER_MAX_CONNECTIONS,
  CIRCUIT_CONVERTER_MIN_CONNECTIONS,
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { useProjectStore } from '@/stores/projectStore'
import type { Circuit, TrunkDevice } from '@/types/schema'

export function clampConverterDcConnectionCount(count: number): number {
  return Math.max(
    CIRCUIT_CONVERTER_MIN_CONNECTIONS,
    Math.min(CIRCUIT_CONVERTER_MAX_CONNECTIONS, Math.round(count))
  )
}

export function getOrdinaryConverterResizeEndpointIds(
  circuit: Circuit,
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  return circuit.endpoints.flatMap((endpoint) => {
    const connection = endpoint.converterDcConnection
    return connection?.converterId === converterId && connection.connectionIndex >= count
      ? [endpoint.id]
      : []
  })
}

export function getOrdinaryConverterResizeTrunkDeviceIds(
  circuit: Circuit,
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  return (circuit.trunkDevices ?? []).flatMap((device) => {
    const connection = device.converterDcConnection
    return connection?.converterId === converterId && connection.connectionIndex >= count
      ? [device.id]
      : []
  })
}

export function getSupplyConverterResizeDeviceIds(
  devices: TrunkDevice[],
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  let activeConverterId: string | undefined
  const result: string[] = []
  for (const device of devices) {
    if (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup') {
      activeConverterId = device.id
      continue
    }
    if (activeConverterId !== converterId) continue
    const connectionIndex = getSupplyConverterDcConnectionIndex(device)
    if (connectionIndex != null && connectionIndex > count) result.push(device.id)
  }
  return result
}

/** Resize a converter and remove everything owned by lanes that disappear. */
export function resizeConverterDcConnections(deviceId: string, requestedCount: number): boolean {
  const store = useProjectStore.getState()
  const found = store.getTrunkDeviceById(deviceId)
  const device = found?.device
  if (!found || !device || !supportsCircuitConverterDcConnections(device)) return false

  const newCount = clampConverterDcConnectionCount(requestedCount)
  if (newCount === getCircuitConverterDcConnectionCount(device)) return false
  const conversionProps = { ...(device.conversionProps ?? {}), dcConnectionCount: newCount }

  if (found.circuit) {
    const endpointIds = getOrdinaryConverterResizeEndpointIds(
      found.circuit,
      deviceId,
      newCount
    )
    if (endpointIds.length > 0) store.deleteEndpoints(endpointIds)
    const trunkDeviceIds = getOrdinaryConverterResizeTrunkDeviceIds(
      found.circuit,
      deviceId,
      newCount
    )
    trunkDeviceIds.forEach((trunkDeviceId) =>
      useProjectStore.getState().deleteTrunkDevice(found.circuit!.id, trunkDeviceId)
    )
    store.updateTrunkDevice(found.circuit.id, deviceId, { conversionProps })
    return true
  }

  if (found.isSupplyDevice && store.currentProject) {
    const installation = getElectricalInstallationFromProject(store.currentProject)
    const panels = getElectricalPanelsFromProject(store.currentProject)
    if (!installation) return false
    const devices = getSupplyFeedDevicesForPanel(
      installation,
      panels,
      found.supplyPanelId ?? panels[0]?.id ?? '',
      found.supplyFeedScope ?? 'root'
    )
    const removedDeviceIds = getSupplyConverterResizeDeviceIds(devices, deviceId, newCount)
    removedDeviceIds.forEach((removedDeviceId) =>
      useProjectStore.getState().deleteSupplyTrunkDevice(removedDeviceId)
    )
    useProjectStore.getState().updateSupplyTrunkDevice(deviceId, { conversionProps })
    return true
  }

  return false
}
