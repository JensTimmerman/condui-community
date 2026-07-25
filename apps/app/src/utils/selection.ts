/**
 * Selection utilities for working with multi-select and entity relationships
 */

import type { Selection } from '@/types/ui'

/**
 * Check if an ID is selected
 */
export function isSelected(selection: Selection, id: string): boolean {
  return selection.ids.includes(id)
}

/**
 * Toggle an ID in the selection
 */
export function toggleSelection(selection: Selection, id: string): Selection {
  if (selection.ids.includes(id)) {
    return {
      ...selection,
      ids: selection.ids.filter((sid) => sid !== id),
    }
  }
  return {
    ...selection,
    ids: [...selection.ids, id],
  }
}

/**
 * Add to selection (for Ctrl+Click)
 */
export function addToSelection(selection: Selection, id: string): Selection {
  if (selection.ids.includes(id)) {
    return selection
  }
  return {
    ...selection,
    ids: [...selection.ids, id],
  }
}

/**
 * Remove from selection
 */
export function removeFromSelection(selection: Selection, id: string): Selection {
  return {
    ...selection,
    ids: selection.ids.filter((sid) => sid !== id),
  }
}

/**
 * Select multiple IDs
 */
export function selectMultiple(
  type: Selection['type'],
  ids: string[]
): Selection {
  return { type, ids }
}

/**
 * Clear selection
 */
export function clearSelection(): Selection {
  return { type: null, ids: [] }
}

/**
 * Select single entity
 */
export function selectSingle(
  type: Selection['type'],
  id: string
): Selection {
  return { type, ids: [id] }
}
