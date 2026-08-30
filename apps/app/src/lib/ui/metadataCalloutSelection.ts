import type { Selection } from '@/types/ui'

function resolveGroupedMetadataSelection(
  selection: Selection,
  selectionType: 'endpoint' | 'trunkDevice',
  targetIds: string[],
  modifiers: { extend: boolean; toggle: boolean }
): Selection {
  const currentIds = selection.type === selectionType ? selection.ids : []
  if (modifiers.extend) {
    return { type: selectionType, ids: [...new Set([...currentIds, ...targetIds])] }
  }
  if (modifiers.toggle) {
    const allSelected = targetIds.every((id) => currentIds.includes(id))
    const nextIds = allSelected
      ? currentIds.filter((id) => !targetIds.includes(id))
      : [...new Set([...currentIds, ...targetIds])]
    return nextIds.length > 0 ? { type: selectionType, ids: nextIds } : { type: null, ids: [] }
  }
  return { type: selectionType, ids: targetIds }
}

export function resolveMetadataCalloutSelection(
  selection: Selection,
  targetIds: string[],
  modifiers: { extend: boolean; toggle: boolean }
): Selection {
  return resolveGroupedMetadataSelection(selection, 'endpoint', targetIds, modifiers)
}

export function resolveTrunkDeviceMetadataCalloutSelection(
  selection: Selection,
  targetIds: string[],
  modifiers: { extend: boolean; toggle: boolean }
): Selection {
  return resolveGroupedMetadataSelection(selection, 'trunkDevice', targetIds, modifiers)
}
