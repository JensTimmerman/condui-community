import { createContext } from 'react'
import type { Point } from '@/types/ui'

export type ResizeConverterWithViewportAnchor = (
  deviceId: string,
  connectionCount: number,
  previousAnchor: Point
) => boolean

export const ConverterResizeViewportContext =
  createContext<ResizeConverterWithViewportAnchor | null>(null)
