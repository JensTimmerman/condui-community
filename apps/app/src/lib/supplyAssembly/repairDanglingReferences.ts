import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  editProjectSupplyAssemblies,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import type { SupplyAttachmentRef } from '@/types/supplyAssembly'

export type SupplyAssemblyReferenceRepairResult = {
  repairedHandoffCount: number
}

function attachmentTargetsRemovedEntity(
  attachment: SupplyAttachmentRef,
  removedPanelIds: ReadonlySet<string>,
  removedRootFeedIds: ReadonlySet<string>
): boolean {
  if (
    (attachment.kind === 'panel-input' ||
      attachment.kind === 'panel-bus-input' ||
      attachment.kind === 'circuit-input') &&
    removedPanelIds.has(attachment.panelId)
  ) {
    return true
  }
  return attachment.kind === 'root-feed' && removedRootFeedIds.has(attachment.rootFeedId)
}

/** Remove load-handoff graph content whose target was removed from the project. */
export function removeSupplyAssemblyHandoffsForTargets(
  project: ProjectWithOptionalV2Electrical,
  removedPanelIds: ReadonlySet<string>,
  removedRootFeedIds: ReadonlySet<string>
): number {
  let repairedHandoffCount = 0

  for (const assembly of editProjectSupplyAssemblies(project)) {
    const removedHandoffNodeIds = new Set(
      assembly.loadHandoffs
        .filter(({ target }) =>
          attachmentTargetsRemovedEntity(target, removedPanelIds, removedRootFeedIds)
        )
        .map(({ handoffNodeId }) => handoffNodeId)
    )
    if (removedHandoffNodeIds.size === 0) continue

    repairedHandoffCount += assembly.loadHandoffs.filter(({ handoffNodeId }) =>
      removedHandoffNodeIds.has(handoffNodeId)
    ).length
    assembly.loadHandoffs = assembly.loadHandoffs.filter(
      ({ handoffNodeId }) => !removedHandoffNodeIds.has(handoffNodeId)
    )
    assembly.nodes = assembly.nodes.filter(({ id }) => !removedHandoffNodeIds.has(id))
    assembly.connections = assembly.connections.filter(
      ({ endpoints }) => !endpoints.some(({ nodeId }) => removedHandoffNodeIds.has(nodeId))
    )

    if (assembly.oneWireGeometry) {
      for (const nodeId of removedHandoffNodeIds) {
        delete assembly.oneWireGeometry.nodePositions[nodeId]
      }
      const remainingConnectionIds = new Set(assembly.connections.map(({ id }) => id))
      for (const connectionId of Object.keys(assembly.oneWireGeometry.connectionWaypoints ?? {})) {
        if (!remainingConnectionIds.has(connectionId)) {
          delete assembly.oneWireGeometry.connectionWaypoints?.[connectionId]
        }
      }
    }
  }

  return repairedHandoffCount
}

/**
 * Compatibility repair for exported projects from versions that left supply
 * handoffs behind after their target panel was deleted.
 */
export function repairDanglingSupplyAssemblyReferences(
  project: ProjectWithOptionalV2Electrical
): SupplyAssemblyReferenceRepairResult {
  const panelIds = new Set([...walkPanels(getProjectElectricalPanels(project))].map(({ id }) => id))
  const feedTopology = getProjectElectricalInstallation(project)?.feedTopology
  const rootFeedIds = feedTopology ? new Set(feedTopology.rootFeeds.map(({ id }) => id)) : undefined
  const allPanelIds = new Set<string>()
  const allRootFeedIds = new Set<string>()
  for (const assembly of project.disciplines?.electrical?.supplyAssemblies ?? []) {
    for (const handoff of assembly.loadHandoffs) {
      if (
        (handoff.target.kind === 'panel-input' ||
          handoff.target.kind === 'panel-bus-input' ||
          handoff.target.kind === 'circuit-input') &&
        !panelIds.has(handoff.target.panelId)
      ) {
        allPanelIds.add(handoff.target.panelId)
      }
      if (
        handoff.target.kind === 'root-feed' &&
        rootFeedIds &&
        !rootFeedIds.has(handoff.target.rootFeedId)
      ) {
        allRootFeedIds.add(handoff.target.rootFeedId)
      }
    }
  }

  if (allPanelIds.size === 0 && allRootFeedIds.size === 0) {
    return { repairedHandoffCount: 0 }
  }

  const repairedHandoffCount = removeSupplyAssemblyHandoffsForTargets(
    project,
    allPanelIds,
    allRootFeedIds
  )
  return { repairedHandoffCount }
}
