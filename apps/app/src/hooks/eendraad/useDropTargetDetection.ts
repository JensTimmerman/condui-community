import { useCallback } from 'react'
import { findDropTarget } from '@/lib/layout/findDropTarget'
import type { DropTarget, FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import { useLayoutTree } from './useLayoutTree'
import type { Point } from '@/types/ui'

/**
 * Hook to detect drop targets during drag operations using tree-based hit testing
 */
export function useDropTargetDetection() {
  const layoutTree = useLayoutTree()
  
  return useCallback(
    (position: Point, options?: FindDropTargetOptions): DropTarget => {
      if (!layoutTree) {
        return { type: null }
      }
      return findDropTarget(layoutTree, position, options)
    },
    [layoutTree]
  )
}
