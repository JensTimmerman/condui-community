import type { QuarantinedItem } from '@/types/schema'
import type { ValidationStateV2 } from '@/types/projectV2'

export type ProjectWithOptionalV2Validation = {
  quarantinedItems?: QuarantinedItem[]
  validation?: ValidationStateV2
}

function hasCompatibilityQuarantineField(document: ProjectWithOptionalV2Validation): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'quarantinedItems')
}

export function syncValidationFromCompatibility(document: ProjectWithOptionalV2Validation): void {
  if (!hasCompatibilityQuarantineField(document)) {
    document.validation = {
      ...document.validation,
      quarantinedItems: document.validation?.quarantinedItems,
    }
    return
  }
  document.validation = {
    ...document.validation,
    quarantinedItems: document.quarantinedItems,
  }
}

export function getQuarantinedItemsFromProject(
  document: ProjectWithOptionalV2Validation
): QuarantinedItem[] {
  return document.validation?.quarantinedItems ?? document.quarantinedItems ?? []
}

export function getMutableQuarantinedItemsForProject(
  document: ProjectWithOptionalV2Validation
): QuarantinedItem[] {
  if (document.validation?.quarantinedItems) return document.validation.quarantinedItems
  const quarantinedItems: QuarantinedItem[] = []
  document.validation = {
    ...document.validation,
    quarantinedItems,
  }
  return quarantinedItems
}
