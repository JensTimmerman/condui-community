import { useEffect, useState } from 'react'

export type ResponsiveEditorMode = 'desktop' | 'compactPortrait' | 'compactLandscape'

export interface ResponsiveEditorModeState {
  mode: ResponsiveEditorMode
  isCompact: boolean
  isPortrait: boolean
  width: number
  height: number
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 }
  }
  return {
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1),
  }
}

export function getResponsiveEditorMode(): ResponsiveEditorModeState {
  const { width, height } = getViewportSize()
  const isPortrait = height >= width
  const coarsePointer =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false

  const compactByWidth = width < 900
  const compactTabletPortrait = coarsePointer && isPortrait && width < 1100
  const compactShortLandscape = coarsePointer && !isPortrait && height < 620
  const isCompact = compactByWidth || compactTabletPortrait || compactShortLandscape

  return {
    mode: !isCompact ? 'desktop' : isPortrait ? 'compactPortrait' : 'compactLandscape',
    isCompact,
    isPortrait,
    width,
    height,
  }
}

export function useResponsiveEditorMode(): ResponsiveEditorModeState {
  const [state, setState] = useState(getResponsiveEditorMode)

  useEffect(() => {
    const update = () => setState(getResponsiveEditorMode())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    const coarseQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null
    coarseQuery?.addEventListener?.('change', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      coarseQuery?.removeEventListener?.('change', update)
    }
  }, [])

  return state
}
