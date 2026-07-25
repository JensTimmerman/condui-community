import type { SymbolLabelDisplayConfig, SymbolLabelLayout, SymbolLabelPosition } from '@/types/schema'

export const DEFAULT_SYMBOL_LABEL_POSITION: SymbolLabelPosition = 'right'
export const DEFAULT_SYMBOL_LABEL_LAYOUT: SymbolLabelLayout = 'stack'

export function getSymbolLabelPosition(
  config?: SymbolLabelDisplayConfig,
): SymbolLabelPosition {
  return config?.position ?? DEFAULT_SYMBOL_LABEL_POSITION
}

export function getSymbolLabelLayout(
  config?: SymbolLabelDisplayConfig,
): SymbolLabelLayout {
  return config?.layout ?? DEFAULT_SYMBOL_LABEL_LAYOUT
}

export function isSymbolLabelVisible(
  config: SymbolLabelDisplayConfig | undefined,
  key: string,
  defaultVisible: boolean = true,
): boolean {
  if (!config?.visibility) return defaultVisible
  const value = config.visibility[key]
  return typeof value === 'boolean' ? value : defaultVisible
}
