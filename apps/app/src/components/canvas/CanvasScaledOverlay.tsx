import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'

interface CanvasScaledOverlayProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  style?: CSSProperties
  transformOrigin?: string
  resolveTransform?: (scale: number) => string
}

export default function CanvasScaledOverlay({
  children,
  className,
  style,
  transformOrigin = 'top right',
  resolveTransform,
  ...rest
}: CanvasScaledOverlayProps) {
  const { scale } = useCanvasOverlayScale()

  return (
    <div
      {...rest}
      className={className}
      style={{
        ...style,
        transform: resolveTransform ? resolveTransform(scale) : `scale(${scale})`,
        transformOrigin,
      }}
    >
      {children}
    </div>
  )
}
