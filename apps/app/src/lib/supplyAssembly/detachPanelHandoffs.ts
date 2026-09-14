import { editProjectSupplyAssemblies, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { resolveAssemblyPanelInput } from './electricalTopology'

/** Remove only the incoming panel edges replaced by an explicit hierarchy move. */
export function detachPanelInputHandoffs(project: ProjectWithOptionalV2Electrical, panelId: string): void {
  for (const assembly of editProjectSupplyAssemblies(project)) {
    const removed = assembly.loadHandoffs.filter(
      (handoff) => resolveAssemblyPanelInput(project, handoff.target)?.panelId === panelId
    )
    if (!removed.length) continue
    assembly.loadHandoffs = assembly.loadHandoffs.filter((handoff) => !removed.includes(handoff))
    const nodeIds = new Set(removed.map((handoff) => handoff.handoffNodeId).filter(
      (nodeId) => !assembly.loadHandoffs.some((handoff) => handoff.handoffNodeId === nodeId)
    ))
    assembly.connections = assembly.connections.filter(
      (connection) => !connection.endpoints.some((endpoint) => nodeIds.has(endpoint.nodeId))
    )
    assembly.nodes = assembly.nodes.filter((node) => !nodeIds.has(node.id))
  }
}
