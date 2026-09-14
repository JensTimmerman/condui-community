import {
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

const DC_SUPPLY_PATHS = new Set(['converter-dc', 'converter-dc-top'])

export function summarizeConverterDcPersistence(
  project: ProjectWithOptionalV2Electrical
): Record<string, unknown> | null {
  const topology = getProjectElectricalInstallation(project)?.feedTopology
  if (!topology) return null

  const rootFeeds = topology.rootFeeds
    .map((feed) => ({
      panelId: feed.panelId,
      devices: (feed.trunkDevices ?? [])
        .filter((device) => DC_SUPPLY_PATHS.has(device.supplyPath ?? ''))
        .map((device) => ({
          id: device.id,
          symbol: device.symbol,
          supplyPath: device.supplyPath,
          trunkPosition: device.trunkPosition,
        })),
    }))
    .filter((feed) => feed.devices.length > 0)

  if (rootFeeds.length === 0) return null

  const dcDeviceIds = new Set(rootFeeds.flatMap((feed) => feed.devices.map((device) => device.id)))
  const assemblies = selectProjectSupplyAssemblies(project).map((assembly) => ({
    id: assembly.id,
    matchingNodeIds: assembly.nodes
      .filter((node) => dcDeviceIds.has(node.id))
      .map((node) => node.id),
    matchingConnectionIds: assembly.connections
      .filter((connection) =>
        connection.endpoints.some((endpoint) => dcDeviceIds.has(endpoint.nodeId))
      )
      .map((connection) => connection.id),
  }))

  return { rootFeeds, assemblies }
}
