/**
 * Date resolver: determines the applicable ruleset date for a validation scope
 */
import type { Panel, Circuit, ProtectionDevice, Endpoint } from '@/types/schema'
import type { Scope } from './types'
import { getExplicitInstallYear, type ProjectWithOptionalInstallYear } from '@/lib/installDates'
import { buildCircuitGraphIndex, resolveCircuitReference } from '@/lib/eendraad/circuitGraph'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type DateResolverProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalInstallYear

export interface ScopeEntityPath {
  type: 'panel' | 'protection' | 'circuit' | 'endpoint'
  id: string
  entity: Panel | ProtectionDevice | Circuit | Endpoint
}

/**
 * Get the entity path from root to the scope entity
 */
export function getScopeEntityPath(project: DateResolverProject, scope: Scope): ScopeEntityPath[] {
  const path: ScopeEntityPath[] = []
  const graph = buildCircuitGraphIndex(project)
  const protectionFeedPaths = new Map<string, ScopeEntityPath[]>()

  const findPath = (panels: Panel[]): boolean => {
    for (const panel of panels) {
      const findInCircuit = (
        circuit: Circuit,
        basePath: ScopeEntityPath[],
        visited = new Set<string>()
      ): boolean => {
        if (visited.has(circuit.id)) return false
        visited.add(circuit.id)
        const circuitPath = [
          ...basePath,
          { type: 'circuit' as const, id: circuit.id, entity: circuit },
        ]
        if (scope.type === 'circuit' && scope.id === circuit.id) {
          path.push(...circuitPath)
          return true
        }
        for (const endpoint of circuit.endpoints) {
          if (scope.type === 'device' && scope.id === endpoint.id) {
            path.push(...circuitPath, { type: 'endpoint', id: endpoint.id, entity: endpoint })
            return true
          }
        }
        for (const subCircuitId of circuit.subCircuitIds ?? []) {
          const referenceTarget = resolveCircuitReference(graph, subCircuitId)
          if (referenceTarget.kind === 'protection') {
            protectionFeedPaths.set(referenceTarget.protection.id, circuitPath)
          } else if (
            referenceTarget.kind === 'circuit' &&
            graph.canonicalOwnerByCircuitId.get(referenceTarget.circuit.id)?.panel.id ===
              panel.id &&
            findInCircuit(referenceTarget.circuit, circuitPath, visited)
          ) {
            return true
          }
        }
        return false
      }

      // Check if scope is this panel
      if (scope.type === 'board' && scope.id === panel.id) {
        path.push({ type: 'panel', id: panel.id, entity: panel })
        return true
      }

      // Check protections
      for (const protection of panel.protections) {
        const protectionBasePath = protectionFeedPaths.get(protection.id) ?? [
          { type: 'panel' as const, id: panel.id, entity: panel },
        ]
        if (scope.type === 'device' && scope.id === protection.id) {
          path.push(...protectionBasePath)
          path.push({ type: 'protection', id: protection.id, entity: protection })
          return true
        }

        // Check circuits under protection
        if (protection.circuits) {
          for (const circuit of protection.circuits) {
            if (
              findInCircuit(circuit, [
                ...protectionBasePath,
                { type: 'protection', id: protection.id, entity: protection },
              ])
            )
              return true
          }
        }
      }

      // Check circuits at panel level
      for (const circuit of panel.circuits) {
        if (findInCircuit(circuit, [{ type: 'panel', id: panel.id, entity: panel }])) return true
      }

      // Check sub-panels recursively
      if (findPath(panel.subPanels)) {
        path.unshift({ type: 'panel', id: panel.id, entity: panel })
        return true
      }
    }
    return false
  }

  findPath(getProjectElectricalPanels(project))
  return path
}

/**
 * Get the applicable ruleset year for a validation scope. Only confirmed electrical
 * dates may relax validation; a building construction year is not evidence that the
 * electrical work dates from the same period. Unknown dates therefore stay current/strict.
 */
export function getApplicableRulesetDate(project: DateResolverProject, scope: Scope): number {
  const path = getScopeEntityPath(project, scope)
  let date = new Date().getFullYear()

  // Walk from root to entity; the nearest override wins.
  for (const node of path) {
    const explicitYear = getExplicitInstallYear(node.entity)
    if (explicitYear != null) date = explicitYear
  }

  return date
}
