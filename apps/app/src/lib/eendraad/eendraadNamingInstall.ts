import type { Installation } from '@/types/schema'

/**
 * Whether feeder-only parent rows should hide the main letter on the one-wire (they still get a code).
 * When true, only rows with no consumer endpoints **and** at least one sub-circuit hide the letter;
 * empty circuits without sub-circuits keep showing it until that topology exists.
 * Default true.
 *
 * Migrates from deprecated `eendraadAutoNamingSkipParentCircuits`.
 */
export function installationHideFeederLetters(inst: Installation | undefined): boolean {
  if (!inst) return true
  if (typeof inst.eendraadAutoNamingHideFeederLetters === 'boolean') {
    return inst.eendraadAutoNamingHideFeederLetters
  }
  if (typeof inst.eendraadAutoNamingSkipParentCircuits === 'boolean') {
    return inst.eendraadAutoNamingSkipParentCircuits
  }
  return true
}
