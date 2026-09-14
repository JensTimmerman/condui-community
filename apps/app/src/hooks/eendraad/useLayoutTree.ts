import { useMemo } from 'react'
import { useEendraadLayout } from './useEendraadLayout'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import { getCachedLayoutTree } from '@/lib/layout/eendraadDerivedLayout'

/**
 * Hook to get the layout as a unified LayoutTree
 *
 * This wraps useEendraadLayout and converts the flat BottomUpLayoutResult
 * into a hierarchical LayoutTree structure.
 *
 * Phase 1: Uses adapter to convert from flat layout
 * Phase 2+: Will directly generate tree via NodeLayouter pattern
 */
export function useLayoutTree(enabled = true): LayoutTree | null {
  const layout = useEendraadLayout(enabled)

  return useMemo<LayoutTree | null>(() => {
    if (!layout) return null
    return getCachedLayoutTree(layout)
  }, [layout])
}
