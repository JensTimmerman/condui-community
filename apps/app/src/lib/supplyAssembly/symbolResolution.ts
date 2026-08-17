import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import type { SupplyNode } from '@/types/supplyAssembly'

const FALLBACK_SYMBOL_BY_NODE_KIND: Partial<Record<SupplyNode['kind'], string>> = {
  'utility-source': 'mains',
  'ac-distribution': 'junction_box',
  'changeover-switch': 'source_changeover',
  'dc-bus': 'junction_box',
  'panel-handoff': 'panel_distribution',
  'integrated-transfer': 'source_changeover',
}

export function resolveSupplyNodeSymbol(node: SupplyNode): SymbolMetadata | undefined {
  return (
    getSymbolById(node.symbol) ??
    (FALLBACK_SYMBOL_BY_NODE_KIND[node.kind]
      ? getSymbolById(FALLBACK_SYMBOL_BY_NODE_KIND[node.kind]!)
      : undefined)
  ) ?? undefined
}
