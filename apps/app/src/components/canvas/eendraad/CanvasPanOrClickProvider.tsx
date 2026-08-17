import type { ReactNode } from 'react'
import { CanvasPanContext, type BeginCanvasPan } from './CanvasPanOrClickGesture'

export function CanvasPanOrClickProvider({
  children,
  onBeginPan,
}: {
  children: ReactNode
  onBeginPan: BeginCanvasPan
}) {
  return <CanvasPanContext.Provider value={onBeginPan}>{children}</CanvasPanContext.Provider>
}
