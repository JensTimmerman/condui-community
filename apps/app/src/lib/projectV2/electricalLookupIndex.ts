import type { Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'

export interface ElectricalLookupIndex {
  panelsById: Map<string, Panel>
  panelsByName: Map<string, Panel>
  protectionsById: Map<string, ProtectionDevice>
  protectionPanelsById: Map<string, Panel>
  circuitsById: Map<string, { circuit: Circuit; parent: Panel | ProtectionDevice }>
  endpointsById: Map<string, { endpoint: Endpoint; circuit: Circuit }>
}

const cache = new WeakMap<Panel[], ElectricalLookupIndex>()
const endpointRenderSignatures = new WeakMap<Endpoint, string>()
const endpointRenderRevisionsByProject = new Map<
  string,
  Map<string, Array<{ signature: string; endpoint: Endpoint }>>
>()
const MAX_ENDPOINT_RENDER_REVISIONS = 2
const MAX_ENDPOINT_RENDER_PROJECTS = 10

function getEndpointRenderSignature(endpoint: Endpoint): string {
  const cached = endpointRenderSignatures.get(endpoint)
  if (cached) return cached
  const signature = JSON.stringify(endpoint)
  endpointRenderSignatures.set(endpoint, signature)
  return signature
}

/**
 * Preserve entity identity across full history snapshots when the endpoint value
 * is unchanged. This lets leaf canvas subscriptions ignore clone-only revisions.
 */
export function getStableEndpointRenderRevision(
  projectId: string,
  endpoint: Endpoint
): Endpoint {
  let projectRevisions = endpointRenderRevisionsByProject.get(projectId)
  if (!projectRevisions) {
    projectRevisions = new Map()
    endpointRenderRevisionsByProject.set(projectId, projectRevisions)
    if (endpointRenderRevisionsByProject.size > MAX_ENDPOINT_RENDER_PROJECTS) {
      const oldestProjectId = endpointRenderRevisionsByProject.keys().next().value
      if (oldestProjectId) endpointRenderRevisionsByProject.delete(oldestProjectId)
    }
  }
  const signature = getEndpointRenderSignature(endpoint)
  const revisions = projectRevisions.get(endpoint.id) ?? []
  const existing = revisions.find((revision) => revision.signature === signature)
  if (existing) return existing.endpoint
  projectRevisions.set(
    endpoint.id,
    [{ signature, endpoint }, ...revisions].slice(0, MAX_ENDPOINT_RENDER_REVISIONS)
  )
  return endpoint
}

function addCircuit(
  index: ElectricalLookupIndex,
  circuit: Circuit,
  parent: Panel | ProtectionDevice
): void {
  if (!index.circuitsById.has(circuit.id)) {
    index.circuitsById.set(circuit.id, { circuit, parent })
  }
  for (const endpoint of circuit.endpoints) {
    if (!index.endpointsById.has(endpoint.id)) {
      index.endpointsById.set(endpoint.id, { endpoint, circuit })
    }
  }
}

function addPanel(index: ElectricalLookupIndex, panel: Panel): void {
  if (!index.panelsById.has(panel.id)) index.panelsById.set(panel.id, panel)
  if (!index.panelsByName.has(panel.name)) index.panelsByName.set(panel.name, panel)

  for (const circuit of panel.circuits) addCircuit(index, circuit, panel)
  for (const protection of panel.protections) {
    if (!index.protectionsById.has(protection.id)) {
      index.protectionsById.set(protection.id, protection)
      index.protectionPanelsById.set(protection.id, panel)
    }
    for (const circuit of protection.circuits ?? []) addCircuit(index, circuit, protection)
  }
  for (const subPanel of panel.subPanels ?? []) addPanel(index, subPanel)
}

/**
 * Build all common electrical entity lookups once per immutable V2 panels revision.
 * Immer preserves that array reference until electrical data changes, so hundreds
 * of mounted canvas subscribers share one linear pass instead of each walking the
 * complete project independently.
 */
export function getElectricalLookupIndex(panels: Panel[]): ElectricalLookupIndex {
  const cached = cache.get(panels)
  if (cached) return cached

  const index: ElectricalLookupIndex = {
    panelsById: new Map(),
    panelsByName: new Map(),
    protectionsById: new Map(),
    protectionPanelsById: new Map(),
    circuitsById: new Map(),
    endpointsById: new Map(),
  }
  for (const panel of panels) addPanel(index, panel)
  cache.set(panels, index)
  return index
}
