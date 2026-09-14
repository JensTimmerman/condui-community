import type { PanelGridModuleRef } from '@/types/schema'

export function panelGridModuleRefKey(ref: PanelGridModuleRef): string {
  if (ref.kind === 'protection') return `protection:${ref.id}`
  if (ref.kind === 'trunkDevice') return `trunkDevice:${ref.id}:${ref.scope}${ref.circuitId ?? ''}`
  return `domotica:${ref.endpointId}:${ref.circuitId}`
}
