import type { Endpoint } from '@/types/schema'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { canSymbolAppearOnSituationPlan } from './situationPlanSymbolEligibility'

/** Whether an endpoint is shown on the situation plan (not one-wire-only or panel-mounted). */
export function endpointSymbolVisibleOnSitplan(endpoint: Endpoint): boolean {
  return canSymbolAppearOnSituationPlan(endpoint.symbol) && !isModularSocket(endpoint)
}
