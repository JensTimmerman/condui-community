import type { QuarantinedItem } from '@/types/schema'
import type { ValidationStateV2 } from '@/types/projectV2'

export type ValidationProject = { validation?: ValidationStateV2 }
export function queryQuarantinedItems(document: ValidationProject): QuarantinedItem[] { return document.validation?.quarantinedItems ?? [] }
export function editQuarantinedItems(document: ValidationProject): QuarantinedItem[] {
  if (!document.validation?.quarantinedItems) document.validation = { ...document.validation, quarantinedItems: [] }
  return document.validation!.quarantinedItems!
}
