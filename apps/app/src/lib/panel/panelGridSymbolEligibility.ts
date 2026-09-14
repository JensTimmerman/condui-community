const OPTIONAL_PANEL_ENDPOINT_SYMBOLS = new Set([
  'domotica',
  'energy_meter',
  'relay',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

/** Symbols whose endpoint representation may be shown in the distribution-panel grid. */
export function symbolCanAppearInPanelGrid(symbol: string | undefined): boolean {
  return symbol != null && OPTIONAL_PANEL_ENDPOINT_SYMBOLS.has(symbol)
}
