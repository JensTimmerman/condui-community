import { useMemo } from 'react'
import { useEendraadLayout } from './useEendraadLayout'
import { buildLayoutTree, type LayoutTree } from '@/lib/layout/layoutTree'

/**
 * Hook to get the layout as a unified LayoutTree
 * 
 * This wraps useEendraadLayout and converts the flat BottomUpLayoutResult
 * into a hierarchical LayoutTree structure.
 * 
 * Phase 1: Uses adapter to convert from flat layout
 * Phase 2+: Will directly generate tree via NodeLayouter pattern
 */
export function useLayoutTree(): LayoutTree | null {
  const layout = useEendraadLayout()
  
  return useMemo<LayoutTree | null>(() => {
    if (!layout) return null
    return buildLayoutTree(layout)
  }, [layout])
}
