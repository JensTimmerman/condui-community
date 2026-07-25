/**
 * Rule pack loader: loads and validates rule packs
 */
import type { RulePack } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertRulePack(pack: unknown): asserts pack is RulePack {
  if (!isRecord(pack)) {
    throw new Error('Expected an object')
  }
  if (typeof pack.id !== 'string') throw new Error('Missing rule pack id')
  if (typeof pack.jurisdiction !== 'string') throw new Error('Missing rule pack jurisdiction')
  if (typeof pack.version !== 'string') throw new Error('Missing rule pack version')
  if (typeof pack.effectiveFrom !== 'number') throw new Error('Missing rule pack effectiveFrom year')
  if (!isRecord(pack.metadata)) throw new Error('Missing rule pack metadata')
  if (!Array.isArray(pack.rules)) throw new Error('Missing rule pack rules')
}

/**
 * Load and validate a rule pack
 * Accepts a RulePack object (from TS import or JSON parsed elsewhere)
 * Returns the validated RulePack or throws if invalid
 */
export function loadRulePack(pack: unknown): RulePack {
  assertRulePack(pack)
  return pack
}

/**
 * Load multiple rule packs
 */
export function loadRulePacks(packs: unknown[]): RulePack[] {
  return packs.map((pack, index) => {
    try {
      return loadRulePack(pack)
    } catch (error) {
      throw new Error(`Failed to load rule pack at index ${index}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
