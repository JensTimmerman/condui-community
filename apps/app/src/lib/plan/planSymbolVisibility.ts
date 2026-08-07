import type { Endpoint } from '@/types/schema'
import { canSymbolAppearOnSituationPlan } from './situationPlanSymbolEligibility'

/** Whether an endpoint's symbol is shown on the situation plan (not one-wire-only). */
export function endpointSymbolVisibleOnSitplan(endpoint: Endpoint): boolean {
  return canSymbolAppearOnSituationPlan(endpoint.symbol)
}
