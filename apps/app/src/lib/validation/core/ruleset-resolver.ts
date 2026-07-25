/**
 * Ruleset resolver: selects the effective rule pack by jurisdiction and date
 */
import type { RulePack } from './types'

/**
 * Select a rule pack from a list based on jurisdiction and effective date
 * Returns the pack where:
 * - jurisdiction matches
 * - effectiveFrom <= date
 * - effectiveTo is null or >= date
 * If multiple packs match, returns the one with the newest effectiveFrom (most recent)
 */
export function selectRulePack(
  packs: RulePack[],
  jurisdiction: string,
  effectiveDate: number
): RulePack | undefined {
  const matchingPacks = packs.filter((pack) => {
    if (pack.jurisdiction !== jurisdiction) return false
    if (pack.effectiveFrom > effectiveDate) return false
    if (pack.effectiveTo != null && pack.effectiveTo < effectiveDate) return false
    return true
  })

  if (matchingPacks.length === 0) return undefined

  // If multiple, pick the one with the newest effectiveFrom
  return matchingPacks.reduce((newest, pack) => {
    return pack.effectiveFrom > newest.effectiveFrom ? pack : newest
  })
}
