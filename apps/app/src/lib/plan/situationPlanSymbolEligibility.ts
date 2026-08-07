import { getSymbolById } from '@/lib/symbols'

const SITUATION_PLAN_EXCLUDED_SYMBOLS = new Set(['domotica', 'energy_meter'])

export function canSymbolAppearOnSituationPlan(symbolId: string | undefined): boolean {
  if (!symbolId || SITUATION_PLAN_EXCLUDED_SYMBOLS.has(symbolId)) return false

  const symbol = getSymbolById(symbolId)
  return symbol?.scope === 'situatieplan' || symbol?.scope === 'both'
}
